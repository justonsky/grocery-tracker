using System.Net;
using System.Text.Json;
using FluentAssertions;
using GroceryTracker.Core.Dtos;
using Microsoft.AspNetCore.Hosting;

namespace GroceryTracker.Api.Tests;

// Inputs that used to reach the database as junk or a 500, the lock on deletes, the shopper's
// local "today", and the other fixes from the October 2026 review.
public class HardeningTests : IDisposable
{
    // 02:00 UTC on Aug 6 is still the evening of Aug 5 in the US.
    private static readonly DateTimeOffset Start = new(2026, 8, 6, 2, 0, 0, TimeSpan.Zero);

    private readonly GroceryTrackerApiFactory _factory = new(Start);
    private readonly HttpClient _client;

    public HardeningTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private async Task<Guid> ProfileAsync() =>
        (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Tester"))).ReadAsAsync<ProfileDto>())!.Id;

    private async Task<Guid> CategoryAsync(string name) =>
        (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!.First(c => c.Name == name).Id;

    private Task<HttpResponseMessage> PutTripAsync(Guid profileId, TripInput input, Guid? tripId = null) =>
        _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{tripId ?? Guid.NewGuid()}", input);

    private static async Task<string?> TypeAsync(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.TryGetProperty("type", out var type) ? type.GetString() : null;
    }

    [Fact]
    public async Task TripSave_RefusesJunk_With400InsteadOfStoringItOrFailing()
    {
        var profile = await ProfileAsync();
        var dairy = await CategoryAsync("Dairy");
        var ok = new TripInput(null, "2026-08-05", null, ["Aldi"], [new TripItemInput("Milk", dairy, "Aldi", true, 3m)]);

        var cases = new[]
        {
            ok with { Items = [new TripItemInput("Milk", dairy, "Aldi", true, 99_999_999_999m)] }, // used to overflow into a 500
            ok with { Budget = 2_000_000m },
            ok with { Items = [new TripItemInput("Milk", Guid.NewGuid(), "Aldi", true, 3m)] },     // unknown category: was an FK 500
            ok with { Date = "garbage" },
            ok with { Date = "" },
            ok with { Date = "2026-02-30" },
            ok with { Items = [new TripItemInput("   ", dairy, "Aldi", true, 3m)] },
            ok with { Items = [new TripItemInput(new string('x', 201), dairy, "Aldi", true, 3m)] },
        };
        foreach (var input in cases)
        {
            var response = await PutTripAsync(profile, input);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, JsonSerializer.Serialize(input));
            (await TypeAsync(response)).Should().Be(ProblemTypes.Validation);
        }

        (await PutTripAsync(profile, ok)).StatusCode.Should().Be(HttpStatusCode.Created);
        var items = (await (await _client.GetAsync("/api/v1/items")).ReadAsAsync<List<ItemDto>>())!;
        items.Should().ContainSingle().Which.Name.Should().Be("Milk");
    }

    [Fact]
    public async Task UnknownCategory_IsRefused_ByRecipesToo()
    {
        var response = await _client.PutJsonAsync($"/api/v1/recipes/{Guid.NewGuid()}",
            new RecipeInput("Soup", null, [new RecipeItemInput("Leeks", Guid.NewGuid())]));
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task LockedPurchases_AreOnlyDeletedWhenConfirmed()
    {
        var profile = await ProfileAsync();
        var dairy = await CategoryAsync("Dairy");
        var trip = (await (await PutTripAsync(profile, TestTrips.At("2026-08-05", "Aldi", TestTrips.Bought("Milk", dairy, 3m)))).ReadAsAsync<TripDto>())!;
        var line = trip.Items.Single();
        _factory.Clock!.Advance(TimeSpan.FromDays(8));

        var refused = await _client.DeleteAsync($"/api/v1/items/{line.ItemId}/lines/{line.Id}");
        refused.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await TypeAsync(refused)).Should().Be(ProblemTypes.PriceLocked);
        var itemRefused = await _client.DeleteAsync($"/api/v1/items/{line.ItemId}");
        itemRefused.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await TypeAsync(itemRefused)).Should().Be(ProblemTypes.PriceLocked);

        (await _client.DeleteAsync($"/api/v1/items/{line.ItemId}/lines/{line.Id}?confirmLocked=true")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await _client.DeleteAsync($"/api/v1/items/{line.ItemId}?confirmLocked=true")).StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task NewLine_NamedLikeALockedOne_IsKept_NotSwallowed()
    {
        var profile = await ProfileAsync();
        var dairy = await CategoryAsync("Dairy");
        var tripId = Guid.NewGuid();
        var trip = (await (await PutTripAsync(profile, TestTrips.At("2026-08-05", "Aldi", TestTrips.Bought("Milk", dairy, 3m)), tripId)).ReadAsAsync<TripDto>())!;
        _factory.Clock!.Advance(TimeSpan.FromDays(8));

        // An older client re-sends everything without ids, plus another (unpriced) milk to pick up.
        var again = new TripInput(null, trip.Date, null, ["Aldi"],
            [new TripItemInput("Milk", dairy, "Aldi", true, 3m), new TripItemInput("Milk", dairy, "Aldi", false, null)]);
        var saved = (await (await PutTripAsync(profile, again, tripId)).ReadAsAsync<TripDto>())!;

        saved.Items.Should().HaveCount(2);
        saved.Items.Should().ContainSingle(i => i.Id == trip.Items.Single().Id && i.PriceLocked);
        saved.Items.Should().ContainSingle(i => i.Price == null && !i.PriceLocked);
    }

    [Fact]
    public async Task Dashboard_CountsByTheShoppersDate_AndOnlyShoppedTrips()
    {
        var profile = await ProfileAsync();
        var dairy = await CategoryAsync("Dairy");
        await PutTripAsync(profile, TestTrips.At("2026-08-05", "Aldi", TestTrips.Bought("Milk", dairy, 3m)));
        await PutTripAsync(profile, TestTrips.At("2026-08-05", "Aldi", TestTrips.Planned("Eggs", dairy))); // just a list

        var local = (await (await _client.GetAsync($"/api/v1/profiles/{profile}/dashboard?today=2026-08-05")).ReadAsAsync<DashboardSummaryDto>())!;
        (local.TodaySpend, local.TodayCount).Should().Be((3m, 1));
        local.MonthlySpend[^1].Month.Should().Be("2026-08");

        // The server clock says Aug 6 in UTC; the device's date is what counts.
        var utc = (await (await _client.GetAsync($"/api/v1/profiles/{profile}/dashboard?today=2026-08-06")).ReadAsAsync<DashboardSummaryDto>())!;
        utc.TodayCount.Should().Be(0);
    }

    [Fact]
    public async Task Trends_UseTheShoppersDate_AndPerUnitAverages()
    {
        var profile = await ProfileAsync();
        var meat = await CategoryAsync("Meat & Seafood");
        // 1.5 lb for $15 and 0.5 lb for $6: $10/lb and $12/lb, not the $10.50 average line total.
        await PutTripAsync(profile, TestTrips.At("2026-08-01", "Aldi", new TripItemInput("Roast Beef", meat, null, true, 15m, Quantity: 1.5m, Unit: "lb")));
        await PutTripAsync(profile, TestTrips.At("2026-08-07", "Aldi", new TripItemInput("Roast Beef", meat, null, true, 6m, Quantity: 0.5m, Unit: "lb")));

        var trends = (await (await _client.GetAsync($"/api/v1/profiles/{profile}/trends?range=30d&today=2026-08-07")).ReadAsAsync<TrendsDto>())!;
        trends.To.Should().Be("2026-08-07"); // a trip dated "tomorrow" in UTC terms is inside the period
        var beef = trends.MostBought.Single(i => i.Name == "Roast Beef");
        (beef.TimesBought, beef.AveragePrice, beef.PriceUnit).Should().Be((2, 11m, "lb"));
    }

    [Fact]
    public async Task Settings_And_Categories_RefuseValuesThatUsedToThrow()
    {
        (await _client.PutJsonAsync("/api/v1/settings", new UpdateSettingsRequest("purple"))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var nullColor = await _client.PutAsync("/api/v1/settings",
            new StringContent("""{"groupColors":{"store:aldi":null}}""", System.Text.Encoding.UTF8, "application/json"));
        nullColor.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        (await _client.PutJsonAsync($"/api/v1/categories/{Guid.NewGuid()}", new CreateCategoryRequest(" "))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await _client.PostJsonAsync("/api/v1/categories", new CreateCategoryRequest(""))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task ReceiptReads_AreRateLimited()
    {
        using var limited = _factory.WithWebHostBuilder(b => b.UseSetting("Receipts:ReadsPerHour", "1"));
        var client = limited.CreateClient();
        await client.PutJsonAsync("/api/v1/settings", new UpdateSettingsRequest(null, ReceiptImport: true));

        var first = await client.PostJsonAsync("/api/v1/receipts/text", new { text = "MILK 3.00" });
        first.StatusCode.Should().NotBe(HttpStatusCode.TooManyRequests);
        var second = await client.PostJsonAsync("/api/v1/receipts/text", new { text = "MILK 3.00" });
        second.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        (await TypeAsync(second)).Should().Be(ProblemTypes.TooManyReceipts);
    }
}
