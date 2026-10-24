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
        {
            if (!SettingsService.IsValidGroupColors(request.GroupColors))
            {
                return Results.Problem(type: ProblemTypes.Validation,
                    title: "Group colors must map store:/category: keys to #rrggbb or \"none\".",
                    statusCode: StatusCodes.Status400BadRequest);
            }
            if (request.ChartScheme is not null && !SettingsService.ChartSchemes.Contains(request.ChartScheme))
            {
                return Results.Problem(type: ProblemTypes.Validation,
                    title: $"Chart scheme must be one of: {string.Join(", ", SettingsService.ChartSchemes)}.",
                    statusCode: StatusCodes.Status400BadRequest);
            }
            if (request.ThemeMode is not null && !SettingsService.ThemeModes.Contains(request.ThemeMode))
            {
                return Results.Problem(type: ProblemTypes.Validation,
                    title: $"Theme mode must be one of: {string.Join(", ", SettingsService.ThemeModes)}.",
                    statusCode: StatusCodes.Status400BadRequest);
            }
            return Results.Ok(await service.UpdateAsync(request, ct));
        });
    }
}
