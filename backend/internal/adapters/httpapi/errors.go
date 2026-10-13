package httpapi

import (
	"errors"
	"fmt"
	"net/http"

	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/ports"
)

// writeError maps errors to RFC 9457 problems (docs/backend/API_SPEC.md). Internal details are
// logged, never returned. Add a case here when the application gains an error; anything unmapped
// becomes a 500.
func (d Deps) writeError(w http.ResponseWriter, r *http.Request, err error) {
	WriteProblem(w, r, d.problemFor(r, err))
}

func (d Deps) problemFor(r *http.Request, err error) Problem {
	var invalid *application.ErrInvalid
	var validation *application.ErrValidation
	var notFound *application.NotFound
	var tooLarge errTooLarge
	switch {
	case errors.As(err, &invalid):
		return problem("invalid-request", "Invalid request", http.StatusBadRequest, invalid.Error(), "invalid-parameter")
	case errors.As(err, &validation):
		p := problem("validation-failed", "Validation failed", http.StatusUnprocessableEntity, fmt.Sprintf("%d validation issue(s).", len(validation.Issues)), "")
		for _, i := range validation.Issues {
			p.Errors = append(p.Errors, ProblemError{Code: i.Code, EntityID: i.EntityID, Path: i.Path, Message: i.Message})
		}
		return p
	case errors.As(err, &notFound):
		return problem("not-found", "Not found", http.StatusNotFound, notFound.Detail, "")
	case errors.Is(err, ports.ErrNotFound):
		return problem("not-found", "Not found", http.StatusNotFound, "", "")
	case errors.Is(err, ports.ErrPreconditionFailed):
		return problem("precondition-failed", "Precondition failed", http.StatusPreconditionFailed, "The topology changed since it was read. Reload it and try again.", "")
	case errors.Is(err, application.ErrReadOnly):
		return problem("read-only", "Method not allowed", http.StatusMethodNotAllowed, err.Error(), "")
	case errors.Is(err, application.ErrImportOverwritesAuthored):
		return problem("import-overwrites-authored", "Conflict", http.StatusConflict, err.Error(), "import-overwrites-authored")
	case errors.Is(err, application.ErrImportedFlow):
		return problem("imported-read-only", "Conflict", http.StatusConflict, err.Error(), "imported-read-only")
	case errors.Is(err, application.ErrNoBoardStore):
		return problem("unavailable", "Service unavailable", http.StatusServiceUnavailable, "This deployment does not store transit boards.", "")
	case errors.Is(err, ports.ErrConflict):
		return problem("conflict", "Conflict", http.StatusConflict, "An item with this ID already exists.", "")
	case errors.As(err, &tooLarge):
		return problem("payload-too-large", "Payload too large", http.StatusRequestEntityTooLarge, tooLarge.Error(), "")
	case errors.As(err, new(errUnsupportedMedia)):
		return problem("unsupported-media-type", "Unsupported media type", http.StatusUnsupportedMediaType, err.Error(), "")
	case errors.Is(err, ports.ErrUnavailable):
		d.Logger.WarnContext(r.Context(), "dependency unavailable", "error", err.Error())
		return problem("unavailable", "Service unavailable", http.StatusServiceUnavailable, "The database is unavailable. Try again later.", "")
	default:
		d.Logger.ErrorContext(r.Context(), "request failed", "error", err.Error())
		return problem("internal", "Internal server error", http.StatusInternalServerError, "", "")
	}
}
