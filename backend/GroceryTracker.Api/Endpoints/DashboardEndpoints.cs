using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/profiles/{profileId:guid}/dashboard", async (Guid profileId, DashboardService service, CancellationToken ct) =>
                Results.Ok(await service.GetSummaryAsync(profileId, ct)))
            .WithTags("Dashboard");

        app.MapGet("/api/v1/profiles/{profileId:guid}/dashboard/tracked-items", async (Guid profileId, string? search, DashboardService service, CancellationToken ct) =>
                Results.Ok(await service.GetTrackedItemsAsync(profileId, search, ct)))
            .WithTags("Dashboard");
    }
}
