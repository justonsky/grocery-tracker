using System.Net;
using ClosedXML.Excel;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// A line's price is what the whole line cost; quantity and unit say how much that bought.
// Averages, charts and the dashboard use the price per item, or per pound for weights.
public class QuantityTests : IDisposable
{
    private static readonly DateTimeOffset FixedNow = new(2026, 8, 15, 12, 0, 0, TimeSpan.Zero);
    private readonly GroceryTrackerApiFactory _factory = new(FixedNow);
    private readonly HttpClient _client;

    public QuantityTests() => _client = _factory.CreateClient();
    public void Dispose() => _factory.Dispose();

    private async Task<Guid> ProfileAsync() =>
        (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Weigher"))).ReadAsAsync<ProfileDto>())!.Id;

    private async Task<Guid> CategoryAsync(string name = "Produce") =>
        (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!.First(c => c.Name == name).Id;

    private static TripItemInput Line(string name, Guid category, decimal price, decimal? quantity = null, string? unit = null) =>
        new(name, category, "BJ's", true, price, null, null, quantity, unit);

    private async Task<TripDto> TripAsync(Guid profile, string date, params TripItemInput[] lines) =>
        (await (await _client.PutJsonAsync($"/api/v1/profiles/{profile}/trips/{Guid.NewGuid()}",
            new TripInput(null, date, null, ["BJ's"], lines.ToList(), "done"))).ReadAsAsync<TripDto>())!;

    [Fact]
    public async Task Lines_StoreQuantityAndUnit_DefaultingToOneEach()
    {
        var profile = await ProfileAsync();
        var produce = await CategoryAsync();
        var trip = await TripAsync(profile, "2026-08-01", Line("Water", produce, 7.12m, 2), Line("Roast Beef", produce, 9.08m, 0.75m, "lb"), Line("Bananas", produce, 1.2m));

        trip.Items.Select(i => (i.ItemName, i.Quantity, i.Unit)).Should().Equal(("Water", 2m, "each"), ("Roast Beef", 0.75m, "lb"), ("Bananas", 1m, "each"));
        trip.Total.Should().Be(17.40m); // totals still add up what was paid
    }

    [Fact]
    public async Task ASaveThatOmitsQuantity_KeepsTheLinesQuantity()
    {
        var profile = await ProfileAsync();
        var produce = await CategoryAsync();
        var id = Guid.NewGuid();
        var first = await (await _client.PutJsonAsync($"/api/v1/profiles/{profile}/trips/{id}",
            new TripInput(null, "2026-08-01", null, ["BJ's"], [Line("Water", produce, 7.12m, 2)], "done"))).ReadAsAsync<TripDto>();

        // An older client (or a queued save) sends no quantity: the line keeps 2.
        var again = await (await _client.PutJsonAsync($"/api/v1/profiles/{profile}/trips/{id}",
            new TripInput(null, "2026-08-01", null, ["BJ's"], [new TripItemInput("Water", produce, "BJ's", true, 7.50m, null, first!.Items[0].Id)], "done"))).ReadAsAsync<TripDto>();
        again!.Items[0].Quantity.Should().Be(2m);
        again.Items[0].Price.Should().Be(7.50m);
    }

    [Theory]
    [InlineData(0, "each")]
    [InlineData(-1, "each")]
    [InlineData(10000, "each")]
    [InlineData(1, "bushel")]
    public async Task InvalidQuantities_AreRejected(double quantity, string unit)
    {
        var profile = await ProfileAsync();
        var produce = await CategoryAsync();
        var response = await _client.PutJsonAsync($"/api/v1/profiles/{profile}/trips/{Guid.NewGuid()}",
            new TripInput(null, "2026-08-01", null, ["BJ's"], [Line("Water", produce, 1m, (decimal)quantity, unit)]));
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Averages_ArePerItem_SoMultiPacksDontSkewThem()
    {
        var profile = await ProfileAsync();
        var bev = await CategoryAsync("Beverages");
        await TripAsync(profile, "2026-08-01", Line("Water", bev, 7.00m, 2));   // 3.50 each
        await TripAsync(profile, "2026-08-08", Line("Water", bev, 3.60m));      // 3.60 each

        var water = (await (await _client.GetAsync("/api/v1/items")).ReadAsAsync<List<ItemDto>>())!.Single(i => i.Name == "Water");
        (water.AveragePrice, water.LastPrice, water.PriceUnit).Should().Be((3.55m, 3.60m, "each"));

        var catalog = (await (await _client.GetAsync("/api/v1/catalog/items")).ReadAsAsync<List<CatalogItemDto>>())!.Single(i => i.Name == "Water");
        catalog.AveragePrice.Should().Be(3.55m);
    }

    [Fact]
    public async Task Weights_AreComparedPerPound_WhateverUnitTheyWereBoughtIn()
    {
        var profile = await ProfileAsync();
        var meat = await CategoryAsync("Meat & Seafood");
        await TripAsync(profile, "2026-07-01", Line("Roast Beef", meat, 9.08m, 0.75m, "lb"));  // 12.11/lb
        await TripAsync(profile, "2026-07-08", Line("Roast Beef", meat, 9.00m, 12m, "oz"));     // 12.00/lb
        await TripAsync(profile, "2026-07-15", Line("Roast Beef", meat, 11.50m, 1m, "lb"));    // 11.50/lb
        await TripAsync(profile, "2026-07-22", Line("Roast Beef", meat, 8.00m));               // a pack: can't compare per pound

        var item = (await (await _client.GetAsync("/api/v1/items")).ReadAsAsync<List<ItemDto>>())!.Single(i => i.Name == "Roast Beef");
        item.PriceUnit.Should().Be("lb");
        item.LastPrice.Should().Be(11.50m);
        item.Unit.Should().Be("lb"); // the editor's default: the last unit among the usual (weighed) purchases

        var history = (await (await _client.GetAsync($"/api/v1/items/{item.Id}/history")).ReadAsAsync<ItemHistoryDto>())!;
        history.PriceUnit.Should().Be("lb");
        history.OtherUnitCount.Should().Be(1);
        history.History.Select(p => p.Price).Should().Equal(11.50m, 12.00m, 12.11m); // newest first
        history.History.Last().Should().Match<PurchasePointDto>(p => p.Quantity == 0.75m && p.Unit == "lb" && p.LineTotal == 9.08m);
        history.Lowest.Should().Be(11.50m);
    }

    [Fact]
    public async Task History_CanBeViewedEitherWay_ForAnItemBoughtBothWays()
    {
        var profile = await ProfileAsync();
        var meat = await CategoryAsync("Meat & Seafood");
        await TripAsync(profile, "2026-07-01", Line("Roast Beef", meat, 9.08m, 0.75m, "lb"));
        await TripAsync(profile, "2026-07-15", Line("Roast Beef", meat, 11.50m, 1m, "lb"));
        await TripAsync(profile, "2026-07-22", Line("Roast Beef", meat, 8.00m));        // a pack
        await TripAsync(profile, "2026-07-29", Line("Roast Beef", meat, 16.50m, 2));    // two packs: 8.25 each
        await TripAsync(profile, "2026-08-05", Line("Roast Beef", meat, 6.00m, 0.5m, "lb"));
        var item = (await (await _client.GetAsync("/api/v1/items")).ReadAsAsync<List<ItemDto>>())!.Single(i => i.Name == "Roast Beef");

        var byDefault = (await (await _client.GetAsync($"/api/v1/items/{item.Id}/history")).ReadAsAsync<ItemHistoryDto>())!;
        byDefault.PriceUnit.Should().Be("lb"); // most purchases were weighed
        byDefault.AvailableUnits!.Select(u => (u.PriceUnit, u.Count)).Should().Equal(("lb", 3), ("each", 2));

        var packs = (await (await _client.GetAsync($"/api/v1/items/{item.Id}/history?unit=each")).ReadAsAsync<ItemHistoryDto>())!;
        packs.PriceUnit.Should().Be("each");
        packs.History.Select(p => p.Price).Should().Equal(8.25m, 8.00m);
        (packs.PurchaseCount, packs.OtherUnitCount, packs.Average).Should().Be((2, 3, 8.13m)); // rounded to the cent

        (await _client.GetAsync($"/api/v1/items/{item.Id}/history?unit=kg")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Dashboard_TrackedItems_UsePerUnitPrices()
    {
        var profile = await ProfileAsync();
        var bev = await CategoryAsync("Beverages");
        await TripAsync(profile, "2026-08-01", Line("Water", bev, 3.50m));
        await TripAsync(profile, "2026-08-08", Line("Water", bev, 7.40m, 2)); // 3.70 each — up 0.20, not 3.90

        var dashboard = (await (await _client.GetAsync($"/api/v1/profiles/{profile}/dashboard")).ReadAsAsync<DashboardSummaryDto>())!;
        var water = dashboard.TrackedItems.Single(i => i.ItemName == "Water");
        (water.LastPrice, water.DeltaFromPrevious, water.Trend).Should().Be((3.70m, 0.20m, "up"));
    }

    [Fact]
    public async Task ItemsPortal_LinesCarryQuantities()
    {
        var profile = await ProfileAsync();
        var meat = await CategoryAsync("Meat & Seafood");
        var trip = await TripAsync(profile, "2026-08-10", Line("Roast Beef", meat, 9.08m, 0.75m, "lb"));
        var itemId = trip.Items[0].ItemId;

        var lines = (await (await _client.GetAsync($"/api/v1/items/{itemId}/lines")).ReadAsAsync<List<ItemLineDto>>())!;
        (lines[0].Quantity, lines[0].Unit).Should().Be((0.75m, "lb"));

        var updated = await (await _client.PutJsonAsync($"/api/v1/items/{itemId}/lines/{lines[0].Id}",
            new SaveItemLineRequest(trip.Id, "BJ's", 12.10m, false, 1m, "lb"))).ReadAsAsync<ItemLineDto>();
        (updated!.Quantity, updated.Unit, updated.Price).Should().Be((1m, "lb", 12.10m));
        (await _client.PutJsonAsync($"/api/v1/items/{itemId}/lines/{lines[0].Id}", new SaveItemLineRequest(trip.Id, "BJ's", 1m, false, 0m, "lb")))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Export_ShowsQuantityUnitAndUnitPrice()
    {
        var profile = await ProfileAsync();
        var meat = await CategoryAsync("Meat & Seafood");
        await TripAsync(profile, "2026-08-10", Line("Roast Beef", meat, 9.08m, 0.75m, "lb"));

        using var workbook = new XLWorkbook(new MemoryStream(await (await _client.GetAsync("/api/v1/export/data.xlsx?includeItems=true")).Content.ReadAsByteArrayAsync()));
        var sheet = workbook.Worksheet("Trip Items");
        string Header(string name) => sheet.Row(1).CellsUsed().First(c => c.GetString() == name).Address.ColumnLetter;
        sheet.Cell($"{Header("Quantity")}2").GetValue<decimal>().Should().Be(0.75m);
        sheet.Cell($"{Header("Unit")}2").GetString().Should().Be("lb");
        sheet.Cell($"{Header("Price")}2").GetValue<decimal>().Should().Be(9.08m);
        sheet.Cell($"{Header("Unit Price")}2").GetValue<decimal>().Should().Be(12.11m);
        var items = workbook.Worksheet("Items");
        items.Cell(2, 5).GetString().Should().Be("lb");
        items.Cell(2, 6).GetValue<decimal>().Should().Be(12.11m);
    }

    [Fact]
    public async Task WeightUnits_AllConvertToPounds()
    {
        var profile = await ProfileAsync();
        var produce = await CategoryAsync();
        // Each works out at $10 a pound, whatever unit it was weighed in.
        await TripAsync(profile, "2026-07-01", Line("Cheese", produce, 10.00m, 1m, "lb"));
        await TripAsync(profile, "2026-07-08", Line("Cheese", produce, 10.00m, 16m, "oz"));
        await TripAsync(profile, "2026-07-15", Line("Cheese", produce, 44.09m, 2m, "kg"));   // 2 kg = 4.409 lb
        await TripAsync(profile, "2026-07-22", Line("Cheese", produce, 10.00m, 453.592m, "g"));

        var history = (await (await _client.GetAsync($"/api/v1/items/{(await ItemAsync("Cheese")).Id}/history")).ReadAsAsync<ItemHistoryDto>())!;
        history.History.Select(p => p.Price).Should().AllBeEquivalentTo(10.00m);
    }

    [Fact]
    public async Task ATie_BetweenCountedAndWeighed_GoesToTheMostRecentPurchase()
    {
        var profile = await ProfileAsync();
        var produce = await CategoryAsync();
        await TripAsync(profile, "2026-07-01", Line("Grapes", produce, 6.00m, 2m, "lb"));
        await TripAsync(profile, "2026-07-08", Line("Grapes", produce, 4.00m));
        var item = await ItemAsync("Grapes");
        (item.PriceUnit, item.LastPrice, item.Unit).Should().Be(("each", 4.00m, "each"));

        await TripAsync(profile, "2026-07-15", Line("Grapes", produce, 9.00m, 3m, "lb"));
        item = await ItemAsync("Grapes");
        (item.PriceUnit, item.LastPrice, item.Unit).Should().Be(("lb", 3.00m, "lb"));
    }

    [Fact]
    public async Task TheEditorsDefaultUnit_ComesFromTheUsualKind_NotAStrayLastPurchase()
    {
        var profile = await ProfileAsync();
        var produce = await CategoryAsync();
        await TripAsync(profile, "2026-07-01", Line("Bananas", produce, 1.80m, 3m, "lb"));
        await TripAsync(profile, "2026-07-08", Line("Bananas", produce, 1.50m, 2.5m, "lb"));
        await TripAsync(profile, "2026-07-15", Line("Bananas", produce, 0.30m)); // one loose banana

        var item = await ItemAsync("Bananas");
        (item.PriceUnit, item.Unit).Should().Be(("lb", "lb"));
    }

    [Fact]
    public async Task ALockedLine_KeepsItsQuantity_WhenATripSaveChangesIt()
    {
        var profile = await ProfileAsync();
        var produce = await CategoryAsync();
        var id = Guid.NewGuid();
        var saved = await (await _client.PutJsonAsync($"/api/v1/profiles/{profile}/trips/{id}",
            new TripInput(null, "2026-08-01", null, ["BJ's"], [Line("Water", produce, 7.00m, 2)], "done"))).ReadAsAsync<TripDto>();
        _factory.Clock!.Advance(TimeSpan.FromDays(8));

        var after = await (await _client.PutJsonAsync($"/api/v1/profiles/{profile}/trips/{id}",
            new TripInput(null, "2026-08-01", null, ["BJ's"], [new TripItemInput("Water", produce, "BJ's", true, 7.00m, null, saved!.Items[0].Id, 5m, "lb")], "done"))).ReadAsAsync<TripDto>();
        (after!.Items[0].PriceLocked, after.Items[0].Quantity, after.Items[0].Unit).Should().Be((true, 2m, "each"));
    }

    [Theory]
    [InlineData(0.0, "each")]
    [InlineData(1.0, "gallon")]
    public async Task ItemsPortal_RejectsBadQuantitiesWhenAddingARecord(double quantity, string unit)
    {
        var profile = await ProfileAsync();
        var produce = await CategoryAsync();
        var trip = await TripAsync(profile, "2026-08-10", Line("Water", produce, 1m));
        var response = await _client.PostJsonAsync($"/api/v1/items/{trip.Items[0].ItemId}/lines",
            new SaveItemLineRequest(trip.Id, "BJ's", 2m, false, (decimal)quantity, unit));
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    private async Task<ItemDto> ItemAsync(string name) =>
        (await (await _client.GetAsync("/api/v1/items")).ReadAsAsync<List<ItemDto>>())!.Single(i => i.Name == name);
}
