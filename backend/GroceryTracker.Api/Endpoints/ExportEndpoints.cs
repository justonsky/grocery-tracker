using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class ExportEndpoints
{
    public static void MapExportEndpoints(this IEndpointRouteBuilder app)
    {
        // ?includeItems=true adds the household item catalogue as its own sheet.
        app.MapGet("/api/v1/export/data.xlsx", async (bool? includeItems, ExportService service, HttpContext ctx, CancellationToken ct) =>
            {
                // A backup is a point-in-time snapshot: never serve a cached copy.
                ctx.Response.Headers.CacheControl = "no-store";
                var bytes = await service.BuildBackupAsync(includeItems ?? false, ct);
                return Results.File(
                    bytes,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "grocery-tracker-backup.xlsx");
            })
            .WithTags("Export");
    }
}
