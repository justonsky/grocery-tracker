using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class HealthEndpoints
{
    // No explicit versioning scheme exists yet — the assembly version is a
    // stable-enough placeholder for "did the build change" checks.
    private static readonly string AppVersion = typeof(HealthEndpoints).Assembly.GetName().Version?.ToString() ?? "0.0.0";

    public static void MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/health", (ServerInstanceHolder holder, HttpContext context) =>
            {
                // Never cached — a stale cached response would defeat the
                // whole point of a reachability probe.
                context.Response.Headers.CacheControl = "no-store";
                return Results.Ok(new HealthDto("grocery-tracker", holder.InstanceId, AppVersion, DateTimeOffset.UtcNow, "ok"));
            })
            .WithTags("Health");
    }
}
