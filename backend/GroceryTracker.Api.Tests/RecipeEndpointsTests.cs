using System.Net;
using ClosedXML.Excel;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

public class RecipeEndpointsTests : IDisposable
{
    private static readonly DateTimeOffset FixedNow = new(2026, 8, 15, 12, 0, 0, TimeSpan.Zero);
    private readonly GroceryTrackerApiFactory _factory = new(FixedNow);
    private readonly HttpClient _client;

    public RecipeEndpointsTests() => _client = _factory.CreateClient();
    public void Dispose() => _factory.Dispose();

    // The smallest headers the server reads a size from — not decodable images, which it never decodes.
    private static byte[] Png(int w, int h, int padding = 0)
    {
        var b = new byte[33 + padding];
        new byte[] { 0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A }.CopyTo(b, 0);
        b[11] = 13; b[12] = (byte)'I'; b[13] = (byte)'H'; b[14] = (byte)'D'; b[15] = (byte)'R';
        for (var i = 0; i < 4; i++) { b[16 + i] = (byte)(w >> (24 - 8 * i)); b[20 + i] = (byte)(h >> (24 - 8 * i)); }
        return b;
    }

    private static byte[] Jpeg(int w, int h)
    {
        var b = new byte[20];
        b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; b[3] = 0xC0; b[4] = 0; b[5] = 11; b[6] = 8;
        b[7] = (byte)(h >> 8); b[8] = (byte)h; b[9] = (byte)(w >> 8); b[10] = (byte)w;
        return b;
    }

    private async Task<Guid> CategoryAsync(string name) =>
        (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!.First(c => c.Name == name).Id;

    private async Task<RecipeDto> SaveAsync(string name, params string[] items)
    {
        var produce = await CategoryAsync("Produce");
        var response = await _client.PutJsonAsync($"/api/v1/recipes/{Guid.NewGuid()}",
            new RecipeInput(name, "A description", items.Select(i => new RecipeItemInput(i, produce, null)).ToList()));
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await response.ReadAsAsync<RecipeDto>())!;
    }

    private async Task<HttpResponseMessage> UploadAsync(Guid id, byte[] bytes) =>
        await _client.PutAsync($"/api/v1/recipes/{id}/photo", new ByteArrayContent(bytes));

    [Fact]
    public async Task Recipe_CreateUpdateListDelete_RoundTrips()
    {
        var recipe = await SaveAsync("Shakshuka", "Eggs", "Tomatoes", "Eggs");
        recipe.Items.Select(i => i.ItemName).Should().Equal("Eggs", "Tomatoes"); // a repeated item is one ingredient
        recipe.PhotoVersion.Should().Be(0);

        var produce = await CategoryAsync("Produce");
        var updated = await (await _client.PutJsonAsync($"/api/v1/recipes/{recipe.Id}",
            new RecipeInput("Shakshuka!", null, [new("Eggs", produce, "6"), new("Feta", produce, null)]))).ReadAsAsync<RecipeDto>();
        updated!.Name.Should().Be("Shakshuka!");
        updated.Description.Should().BeNull();
        updated.Items.Select(i => (i.ItemName, i.Amount)).Should().Equal(("Eggs", "6"), ("Feta", null));

        (await (await _client.GetAsync("/api/v1/recipes")).ReadAsAsync<List<RecipeDto>>())!.Should().ContainSingle(r => r.Id == recipe.Id);
        (await _client.DeleteAsync($"/api/v1/recipes/{recipe.Id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await _client.GetAsync($"/api/v1/recipes/{recipe.Id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await _client.DeleteAsync($"/api/v1/recipes/{recipe.Id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Theory]
    [InlineData("", 1)]
    [InlineData("Has a name", 0)]
    public async Task Recipe_NeedsANameAndAtLeastOneItem(string name, int itemCount)
    {
        var items = Enumerable.Range(0, itemCount).Select(i => new RecipeItemInput($"Item {i}")).ToList();
        (await _client.PutJsonAsync($"/api/v1/recipes/{Guid.NewGuid()}", new RecipeInput(name, null, items)))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Recipe_ItemsAreTheHouseholdsItems_WithTheirAveragePrices()
    {
        var profile = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Cook"))).ReadAsAsync<ProfileDto>())!;
        var produce = await CategoryAsync("Produce");
        await _client.PostJsonAsync($"/api/v1/profiles/{profile.Id}/trips",
            TestTrips.At("2026-08-01", "Aldi", TestTrips.Bought("Eggs", produce, 4m)));
        await _client.PostJsonAsync($"/api/v1/profiles/{profile.Id}/trips",
            TestTrips.At("2026-08-08", "Aldi", TestTrips.Bought("Eggs", produce, 6m)));

        var recipe = await SaveAsync("Omelette", "Eggs", "Chives");

        recipe.Items.Single(i => i.ItemName == "Eggs").AveragePrice.Should().Be(5m);
        recipe.Items.Single(i => i.ItemName == "Chives").AveragePrice.Should().BeNull();
        recipe.EstimatedCost.Should().Be(5m);
        var items = await (await _client.GetAsync("/api/v1/catalog/items")).ReadAsAsync<List<CatalogItemDto>>();
        items!.Select(i => i.Name).Should().Contain("Eggs").And.Contain("Chives"); // Chives was created for the recipe
    }

    [Fact]
    public async Task Photo_WithinLimits_IsStored_Served_AndVersioned()
    {
        var recipe = await SaveAsync("Soup", "Leeks");
        var bytes = Jpeg(1200, 900);

        var first = await (await UploadAsync(recipe.Id, bytes)).ReadAsAsync<RecipeDto>();
        first!.PhotoVersion.Should().BePositive();
        var second = await (await UploadAsync(recipe.Id, Png(800, 800))).ReadAsAsync<RecipeDto>();
        second!.PhotoVersion.Should().BeGreaterThan(first.PhotoVersion);

        var served = await _client.GetAsync($"/api/v1/recipes/{recipe.Id}/photo?v={second.PhotoVersion}");
        served.StatusCode.Should().Be(HttpStatusCode.OK);
        served.Content.Headers.ContentType!.MediaType.Should().Be("image/png");
        served.Headers.CacheControl!.ToString().Should().Contain("immutable");
        (await served.Content.ReadAsByteArrayAsync()).Should().Equal(Png(800, 800));

        var removed = await (await _client.DeleteAsync($"/api/v1/recipes/{recipe.Id}/photo")).ReadAsAsync<RecipeDto>();
        removed!.PhotoVersion.Should().Be(0);
        (await _client.GetAsync($"/api/v1/recipes/{recipe.Id}/photo")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        // The photo URL is cached as immutable, so a new photo after a removal never reuses a version.
        var third = await (await UploadAsync(recipe.Id, Jpeg(640, 480))).ReadAsAsync<RecipeDto>();
        third!.PhotoVersion.Should().BeGreaterThan(second.PhotoVersion);
    }

    [Theory]
    [InlineData(1601, 900)]
    [InlineData(900, 4000)]
    public async Task Photo_TooManyPixels_IsRefusedSoItCanBeCropped(int w, int h)
    {
        var recipe = await SaveAsync("Soup", "Leeks");
        var response = await UploadAsync(recipe.Id, Png(w, h));
        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        (await response.Content.ReadAsStringAsync()).Should().Contain("/errors/photo-too-large");
        (await _client.GetAsync($"/api/v1/recipes/{recipe.Id}")).ReadAsAsync<RecipeDto>().Result!.PhotoVersion.Should().Be(0);
    }

    [Fact]
    public async Task Photo_TooManyBytes_OrNotAnImage_IsRefused()
    {
        var recipe = await SaveAsync("Soup", "Leeks");
        (await UploadAsync(recipe.Id, Png(800, 800, padding: 5 * 1024 * 1024 + 1))).StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        (await UploadAsync(recipe.Id, "not an image at all, just text"u8.ToArray())).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await UploadAsync(Guid.NewGuid(), Png(10, 10))).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Trip_PlannedMeals_RoundTrip_KeepOrder_AndDropWhenTheRecipeIsDeleted()
    {
        var profile = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Planner"))).ReadAsAsync<ProfileDto>())!;
        var a = await SaveAsync("Shakshuka", "Eggs");
        var b = await SaveAsync("Oats", "Rolled oats");
        await UploadAsync(b.Id, Jpeg(400, 300));
        var produce = await CategoryAsync("Produce");
        var tripId = Guid.NewGuid();
        var input = TestTrips.At("2026-08-20", "Aldi", TestTrips.Planned("Eggs", produce)) with { RecipeIds = [b.Id, a.Id, Guid.NewGuid()] };

        var saved = await (await _client.PutJsonAsync($"/api/v1/profiles/{profile.Id}/trips/{tripId}", input)).ReadAsAsync<TripDto>();
        saved!.Recipes!.Select(r => (r.Name, r.PhotoVersion > 0, r.ItemCount)).Should().Equal(("Oats", true, 1), ("Shakshuka", false, 1)); // unknown id ignored

        // A save that doesn't mention meals (an older queued payload) leaves them; an empty list clears them.
        var kept = await (await _client.PutJsonAsync($"/api/v1/profiles/{profile.Id}/trips/{tripId}", input with { RecipeIds = null })).ReadAsAsync<TripDto>();
        kept!.Recipes.Should().HaveCount(2);

        (await _client.DeleteAsync($"/api/v1/recipes/{a.Id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        var after = await (await _client.GetAsync($"/api/v1/profiles/{profile.Id}/trips/{tripId}")).ReadAsAsync<TripDto>();
        after!.Recipes!.Select(r => r.Name).Should().Equal("Oats");
        after.Items.Should().ContainSingle(i => i.ItemName == "Eggs"); // its lines stay

        var cleared = await (await _client.PutJsonAsync($"/api/v1/profiles/{profile.Id}/trips/{tripId}", input with { RecipeIds = [] })).ReadAsAsync<TripDto>();
        cleared!.Recipes.Should().BeEmpty();
    }

    [Fact]
    public async Task Recipe_ReportsHowOftenItWasPlanned()
    {
        var profile = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Counter"))).ReadAsAsync<ProfileDto>())!;
        var recipe = await SaveAsync("Stew", "Okra");
        var produce = await CategoryAsync("Produce");
        foreach (var date in new[] { "2026-07-01", "2026-08-01" })
        {
            await _client.PutJsonAsync($"/api/v1/profiles/{profile.Id}/trips/{Guid.NewGuid()}",
                TestTrips.At(date, "Aldi", TestTrips.Bought("Okra", produce, 2m)) with { RecipeIds = [recipe.Id] });
        }

        var loaded = await (await _client.GetAsync($"/api/v1/recipes/{recipe.Id}")).ReadAsAsync<RecipeDto>();
        (loaded!.TripCount, loaded.LastPlanned).Should().Be((2, "2026-08-01"));
    }

    [Fact]
    public async Task Merging_AnItemAway_MovesItsRecipeLinesToTheTarget()
    {
        var recipe = await SaveAsync("Salad", "Tomato", "Tomatoes", "Basil");
        var items = (await (await _client.GetAsync("/api/v1/catalog/items")).ReadAsAsync<List<CatalogItemDto>>())!;
        var source = items.Single(i => i.Name == "Tomato");
        var target = items.Single(i => i.Name == "Tomatoes");

        (await _client.PostJsonAsync($"/api/v1/items/{source.Id}/merge", new MergeItemRequest(target.Id, null))).EnsureSuccessStatusCode();

        var loaded = await (await _client.GetAsync($"/api/v1/recipes/{recipe.Id}")).ReadAsAsync<RecipeDto>();
        loaded!.Items.Select(i => i.ItemName).Should().Equal("Tomatoes", "Basil"); // had both: one left
    }

    [Fact]
    public async Task Trends_ListsPopularMeals_AndMealsThatWentQuiet()
    {
        var profile = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Meals"))).ReadAsAsync<ProfileDto>())!;
        var hot = await SaveAsync("Bulgogi", "Beef");
        var gone = await SaveAsync("Radish soup", "Radish");
        var produce = await CategoryAsync("Produce");
        async Task PlanAsync(string date, params Guid[] ids) =>
            await _client.PutJsonAsync($"/api/v1/profiles/{profile.Id}/trips/{Guid.NewGuid()}",
                TestTrips.At(date, "Aldi", TestTrips.Bought("Beef", produce, 5m)) with { RecipeIds = ids.ToList() });
        // 90-day period 2026-05-18..2026-08-15, recent window from 2026-07-17
        await PlanAsync("2026-05-20", hot.Id, gone.Id);
        await PlanAsync("2026-06-10", hot.Id, gone.Id);
        await PlanAsync("2026-07-01", hot.Id);
        await PlanAsync("2026-07-25", hot.Id);
        await PlanAsync("2025-01-01", gone.Id); // outside the period

        var trends = (await (await _client.GetAsync($"/api/v1/profiles/{profile.Id}/trends")).ReadAsAsync<TrendsDto>())!;

        trends.PopularRecipes!.Select(r => (r.Name, r.TimesPlanned)).Should().Equal(("Bulgogi", 4), ("Radish soup", 2));
        var quiet = trends.QuietRecipes.Should().ContainSingle().Which;
        (quiet.Name, quiet.EarlierCount, quiet.LastPlanned).Should().Be(("Radish soup", 2, "2026-06-10"));
    }

    [Fact]
    public async Task Export_HasARecipesSheet_OnlyWhenThereAreRecipes()
    {
        async Task<XLWorkbook> ExportAsync() =>
            new(new MemoryStream(await (await _client.GetAsync("/api/v1/export/data.xlsx")).Content.ReadAsByteArrayAsync()));

        using (var none = await ExportAsync()) none.Worksheets.Contains("Recipes").Should().BeFalse();

        await SaveAsync("Pancakes", "Flour", "Milk");
        using var workbook = await ExportAsync();
        var sheet = workbook.Worksheet("Recipes");
        (sheet.Cell(2, 1).GetString(), sheet.Cell(2, 3).GetValue<int>(), sheet.Cell(2, 4).GetString()).Should().Be(("Pancakes", 2, "Flour, Milk"));
    }
}
