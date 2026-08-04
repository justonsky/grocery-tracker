using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Api;

// Converts any exception that escapes an endpoint into a stable ProblemDetails
// body instead of a raw, bodyless 500. This matters specifically for the
// offline-sync outbox: a bare 500 is indistinguishable from "server
// restarting" (transient — keep retrying), so without a structured body a
// real data bug becomes an infinite client-side retry loop.
public class AppExceptionHandler(IProblemDetailsService problemDetailsService, ILogger<AppExceptionHandler> logger)
    : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        logger.LogError(exception, "Unhandled exception on {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);

        var (type, title) = exception switch
        {
            DbUpdateException => (ProblemTypes.DbUpdate, "The database update failed."),
            _ => (ProblemTypes.Unexpected, "An unexpected error occurred."),
        };

        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;

        return await problemDetailsService.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails = new ProblemDetails
            {
                Status = StatusCodes.Status500InternalServerError,
                Type = type,
                Title = title,
                Detail = exception.Message,
            },
        });
    }
}
