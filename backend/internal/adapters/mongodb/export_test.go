package mongodb

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// InsertRaw writes a document without the adapter's checks (tests of database-side constraints).
func (s *Store) InsertRaw(ctx context.Context, collection string, doc any) error {
	_, err := s.coll(collection).InsertOne(ctx, doc)
	return mapErr(err)
}

// DeleteRaw removes a document by _id (tests).
func (s *Store) DeleteRaw(ctx context.Context, collection, id string) error {
	_, err := s.coll(collection).DeleteOne(ctx, bson.D{{Key: "_id", Value: id}})
	return mapErr(err)
}
