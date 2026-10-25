using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Endpoints;

public static class ReceiptEndpoints
{
    // Rate-limit policy for the two endpoints that call the (paid) receipt reader.
    public const string ReadPolicy = "receipt-reads";

    public static void MapReceiptEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/receipts").WithTags("Receipts");

        group.MapGet("/status", async (ReceiptService service, CancellationToken ct) => Results.Ok(await service.StatusAsync(ct)));

        // The body is the photo itself (JPEG, PNG or WebP). X-Receipt-Fixture names a fixture when the
        // server is configured with the fixture reader (tests and demos only); it is ignored otherwise.
        group.MapPost("/", async (HttpRequest request, ReceiptService service, CancellationToken ct) =>
        {
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await request.Body.ReadAsync(chunk, ct)) > 0)
            {
                buffer.Write(chunk, 0, read);
                if (buffer.Length > ReceiptService.MaxImageBytes)
                {
                    return Results.Problem(type: ProblemTypes.Validation, title: "Receipt photos can be at most 7 MB.", statusCode: StatusCodes.Status413PayloadTooLarge);
                }
            }
            var bytes = buffer.ToArray();
            if (!ImageHeader.TryRead(bytes, out var contentType, out _, out _))
            {
                return Results.Problem(type: ProblemTypes.Validation, title: "That file isn't a JPEG, PNG or WebP image.", statusCode: StatusCodes.Status400BadRequest);
            }
            return ToResult(await service.CreateAsync(bytes, contentType, null, Fixture(request), ct));
        }).RequireRateLimiting(ReadPolicy);

        group.MapPost("/text", async (ReceiptTextRequest body, HttpRequest request, ReceiptService service, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.Text) || body.Text.Length > 20_000)
            {
                return Results.Problem(type: ProblemTypes.Validation, title: "Paste the receipt's text (up to 20,000 characters).", statusCode: StatusCodes.Status400BadRequest);
            }
            return ToResult(await service.CreateAsync(null, null, body.Text, Fixture(request), ct));
        }).RequireRateLimiting(ReadPolicy);

        // store: show the suggestions for another store than the one the receipt was taken to be.
        group.MapGet("/{id:guid}", async (Guid id, string? store, ReceiptService service, CancellationToken ct) =>
            await service.GetAsync(id, store, ct) is { } draft ? Results.Ok(draft) : NotFound());

        group.MapPost("/{id:guid}/apply", async (Guid id, ApplyReceiptRequest body, ReceiptService service, CancellationToken ct) =>
        {
            var (result, applied) = await service.ApplyAsync(id, body, ct);
            return result switch
            {
                ReceiptResult.Ok => Results.Ok(applied),
                ReceiptResult.NotFound => NotFound(),
                ReceiptResult.AlreadyApplied => Results.Problem(type: ProblemTypes.ReceiptApplied, title: "This receipt has already been applied.", statusCode: StatusCodes.Status409Conflict),
                _ => Results.Problem(type: ProblemTypes.Validation, title: "Name the store, and an item for each kept line.", statusCode: StatusCodes.Status400BadRequest),
            };
        });

        group.MapDelete("/{id:guid}", async (Guid id, ReceiptService service, CancellationToken ct) =>
            await service.DeleteAsync(id, ct) ? Results.NoContent() : NotFound());

        app.MapGet("/api/v1/items/{itemId:guid}/aliases", async (Guid itemId, ReceiptService service, CancellationToken ct) =>
            await service.AliasesForItemAsync(itemId, ct) is { } aliases ? Results.Ok(aliases)
                : Results.Problem(type: ProblemTypes.ItemNotFound, title: "Item not found.", statusCode: StatusCodes.Status404NotFound))
            .WithTags("Receipts");

        // Add a receipt name by hand, or correct one (store, printed text, code, or the item it means).
        app.MapPost("/api/v1/items/{itemId:guid}/aliases", async (Guid itemId, SaveItemAliasRequest body, ReceiptService service, CancellationToken ct) =>
            AliasResult(await service.SaveAliasAsync(null, itemId, body, ct), created: true)).WithTags("Receipts");

        app.MapPut("/api/v1/item-aliases/{aliasId:guid}", async (Guid aliasId, SaveItemAliasRequest body, ReceiptService service, CancellationToken ct) =>
            AliasResult(await service.SaveAliasAsync(aliasId, null, body, ct), created: false)).WithTags("Receipts");

        app.MapDelete("/api/v1/item-aliases/{aliasId:guid}", async (Guid aliasId, ReceiptService service, CancellationToken ct) =>
            await service.DeleteAliasAsync(aliasId, ct) ? Results.NoContent()
                : Results.Problem(type: ProblemTypes.Validation, title: "Receipt name not found.", statusCode: StatusCodes.Status404NotFound))
            .WithTags("Receipts");
    }

    private static IResult AliasResult((ReceiptResult Result, ItemAliasDto? Alias) outcome, bool created) => outcome.Result switch
    {
        ReceiptResult.Ok when created => Results.Created($"/api/v1/item-aliases/{outcome.Alias!.Id}", outcome.Alias),
        ReceiptResult.Ok => Results.Ok(outcome.Alias),
        ReceiptResult.Conflict => Results.Problem(type: ProblemTypes.AliasConflict,
            title: "That store already has this receipt name (or item code) for an item.", statusCode: StatusCodes.Status409Conflict),
        ReceiptResult.NotFound => Results.Problem(type: ProblemTypes.ItemNotFound, title: "Receipt name or item not found.", statusCode: StatusCodes.Status404NotFound),
        _ => Results.Problem(type: ProblemTypes.Validation, title: "A receipt name needs a store and the text as printed.", statusCode: StatusCodes.Status400BadRequest),
    };

    private static string? Fixture(HttpRequest request) => request.Headers["X-Receipt-Fixture"].FirstOrDefault();

    private static IResult ToResult((ReceiptResult Result, ReceiptDraftDto? Draft, string? Error) outcome) => outcome.Result switch
    {
        ReceiptResult.Ok => Results.Created($"/api/v1/receipts/{outcome.Draft!.Id}", outcome.Draft),
        ReceiptResult.NotConfigured => Results.Problem(type: ProblemTypes.ReceiptsNotConfigured,
            title: "Receipt reading isn't set up on the server (it needs an API key: Receipts__ApiKey).", statusCode: StatusCodes.Status409Conflict),
        ReceiptResult.Disabled => Results.Problem(type: ProblemTypes.ReceiptsDisabled,
            title: "Receipt import is turned off in Settings.", statusCode: StatusCodes.Status409Conflict),
        _ => Results.Problem(type: ProblemTypes.ReceiptUnreadable,
            title: outcome.Error ?? "The receipt couldn't be read.", statusCode: StatusCodes.Status502BadGateway),
    };

    private static IResult NotFound() =>
        Results.Problem(type: ProblemTypes.ReceiptNotFound, title: "Receipt not found.", statusCode: StatusCodes.Status404NotFound);
}
