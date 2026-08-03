using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/settings").WithTags("Settings");

        group.MapGet("/", async (SettingsService service, CancellationToken ct) =>
            Results.Ok(await service.GetAsync(ct)));

        group.MapPut("/", async (UpdateSettingsRequest request, SettingsService service, CancellationToken ct) =>
            Results.Ok(await service.UpdateAsync(request, ct)));
    }
}
