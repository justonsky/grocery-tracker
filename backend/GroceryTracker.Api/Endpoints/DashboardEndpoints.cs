using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/profiles/{profileId:guid}/dashboard").WithTags("Dashboard");

        // ?today=yyyy-MM-dd: the device's local date, which "today" and "this month" are counted by.
        group.MapGet("/", async (Guid profileId, string? today, DashboardService service, CancellationToken ct) =>
            Results.Ok(await service.GetSummaryAsync(profileId, today, ct)));

        group.MapGet("/tracked-items", async (Guid profileId, string? search, DashboardService service, CancellationToken ct) =>
            Results.Ok(await service.GetTrackedItemsAsync(profileId, search, ct)));

        // Replaces the profile's grid (idempotent — the offline outbox targets it).
        group.MapPut("/tracked-items", async (Guid profileId, SetTrackedItemsRequest request, DashboardService service, CancellationToken ct) =>
        {
            var (found, items) = await service.SetTrackedItemsAsync(profileId, request.ItemIds, ct);
            return found
                ? Results.Ok(items)
                : Results.Problem(type: ProblemTypes.ProfileNotFound, title: "Profile not found.", statusCode: StatusCodes.Status404NotFound);
        });
    }
}
