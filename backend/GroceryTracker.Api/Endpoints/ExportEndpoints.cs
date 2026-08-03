using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class ExportEndpoints
{
    public static void MapExportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/export/data.xlsx", async (ExportService service, CancellationToken ct) =>
            {
                var bytes = await service.BuildBackupAsync(ct);
                return Results.File(
                    bytes,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "grocery-tracker-backup.xlsx");
            })
            .WithTags("Export");
    }
}
