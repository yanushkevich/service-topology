package mongodb

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strconv"

	"go.mongodb.org/mongo-driver/v2/bson"

	"servicetopology/backend/internal/fixtures"
)

// Stored documents are the domain values' canonical JSON (the contract's field names and shapes),
// converted to BSON directly. Plain JSON is mapped value by value: objects become documents, never
// Extended JSON types, so user data such as {"$date": "x"} in metadata round-trips literally.
// Numbers that are integers become int64, others float64; both convert back to the same JSON.

// toDocument converts a value's JSON encoding to an ordered BSON document.
func toDocument(v any) (bson.D, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	val, err := readJSON(dec)
	if err != nil {
		return nil, err
	}
	d, ok := val.(bson.D)
	if !ok {
		return nil, fmt.Errorf("mongodb: %T does not encode to a JSON object", v)
	}
	return d, nil
}

func readJSON(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			d := bson.D{}
			for dec.More() {
				key, err := dec.Token()
				if err != nil {
					return nil, err
				}
				val, err := readJSON(dec)
				if err != nil {
					return nil, err
				}
				d = append(d, bson.E{Key: key.(string), Value: val})
			}
			_, err := dec.Token() // '}'
			return d, err
		case '[':
			a := bson.A{}
			for dec.More() {
				val, err := readJSON(dec)
				if err != nil {
					return nil, err
				}
				a = append(a, val)
			}
			_, err := dec.Token() // ']'
			return a, err
		}
		return nil, fmt.Errorf("mongodb: unexpected JSON delimiter %v", t)
	case json.Number:
		if i, err := t.Int64(); err == nil {
			return i, nil
		}
		return t.Float64()
	default: // string, bool, nil
		return t, nil
	}
}

// toJSON converts a stored document back to JSON, leaving out the top-level keys in skip
// (_id and backend-only bookkeeping). Only the BSON types toDocument writes are accepted.
func toJSON(doc bson.Raw, skip map[string]bool) ([]byte, error) {
	var buf bytes.Buffer
	if err := writeDocument(&buf, doc, skip); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeDocument(buf *bytes.Buffer, doc bson.Raw, skip map[string]bool) error {
	elems, err := doc.Elements()
	if err != nil {
		return err
	}
	buf.WriteByte('{')
	first := true
	for _, e := range elems {
		key := e.Key()
		if skip[key] {
			continue
		}
		if !first {
			buf.WriteByte(',')
		}
		first = false
		k, _ := json.Marshal(key)
		buf.Write(k)
		buf.WriteByte(':')
		if err := writeValue(buf, e.Value()); err != nil {
			return fmt.Errorf("%s: %w", key, err)
		}
	}
	buf.WriteByte('}')
	return nil
}

func writeValue(buf *bytes.Buffer, v bson.RawValue) error {
	switch v.Type {
	case bson.TypeEmbeddedDocument:
		return writeDocument(buf, v.Document(), nil)
	case bson.TypeArray:
		vals, err := v.Array().Values()
		if err != nil {
			return err
		}
		buf.WriteByte('[')
		for i, item := range vals {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := writeValue(buf, item); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
	case bson.TypeString:
		s, _ := json.Marshal(v.StringValue())
		buf.Write(s)
	case bson.TypeInt64:
		buf.WriteString(strconv.FormatInt(v.Int64(), 10))
	case bson.TypeInt32:
		buf.WriteString(strconv.FormatInt(int64(v.Int32()), 10))
	case bson.TypeDouble:
		f := v.Double()
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return fmt.Errorf("non-finite number")
		}
		s, _ := json.Marshal(f)
		buf.Write(s)
	case bson.TypeBoolean:
		buf.WriteString(strconv.FormatBool(v.Boolean()))
	case bson.TypeNull:
		buf.WriteString("null")
	default:
		return fmt.Errorf("unsupported stored BSON type %v", v.Type)
	}
	return nil
}

// decodeStrict decodes JSON into a domain value, rejecting unknown fields so stored documents that
// drift from the domain model fail loudly.
var decodeStrict = fixtures.DecodeStrict

// fromDocument decodes a stored document (minus skip) into a domain value.
func fromDocument(doc bson.Raw, skip map[string]bool, into any) error {
	raw, err := toJSON(doc, skip)
	if err != nil {
		return err
	}
	return decodeStrict(raw, into)
}

// fromField decodes the embedded document stored under key.
func fromField(doc bson.Raw, key string, into any) error {
	v, err := doc.LookupErr(key)
	if err != nil {
		return fmt.Errorf("mongodb: stored document has no %s", key)
	}
	sub, ok := v.DocumentOK()
	if !ok {
		return fmt.Errorf("mongodb: stored %s is not a document", key)
	}
	return fromDocument(sub, nil, into)
}
