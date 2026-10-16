using System.Net;
using ClosedXML.Excel;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

public class ExportEndpointsTests : IDisposable
{
    private readonly GroceryTrackerApiFactory _factory = new();
    private readonly HttpClient _client;

    public ExportEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private async Task<XLWorkbook> ExportAsync(string query = "")
    {
        var response = await _client.GetAsync($"/api/v1/export/data.xlsx{query}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.Should()
            .Be("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        return new XLWorkbook(new MemoryStream(await response.Content.ReadAsByteArrayAsync()));
    }

    // Header name → 1-based column, so assertions don't hard-code positions.
    private static Dictionary<string, int> Columns(IXLWorksheet sheet) =>
        sheet.Row(1).CellsUsed().ToDictionary(c => c.GetString(), c => c.Address.ColumnNumber);

    private async Task<(Guid ProfileId, Guid DairyId)> SeedAsync()
    {
        var profileId = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Export Tester")))
            .ReadAsAsync<ProfileDto>())!.Id;
        var dairyId = (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!
            .First(c => c.Name == "Dairy").Id;

        // A finished trip with estimates: 4.00 + 5.00 estimated, 3.49 + 5.50 paid.
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("Big shop", "2026-08-01", 20m, ["Costco"],
            [
                new TripItemInput("Whole Milk", dairyId, "Costco", true, 3.49m, Estimate: 4.00m),
                new TripItemInput("Butter", dairyId, "Costco", true, 5.50m, Estimate: 5.00m),
            ], Status: "done"));
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("Weekly stock-up", "2026-08-02", null, [], [TestTrips.Planned("Bananas", dairyId)]));
        return (profileId, dairyId);
    }

    [Fact]
    public async Task Export_HasProfilesTripsAndTripItems_ButNoItemsSheetByDefault()
    {
        await SeedAsync();
        using var workbook = await ExportAsync();

        workbook.Worksheets.Select(w => w.Name).Should().Equal("Profiles", "Trips", "Trip Items");
        workbook.Worksheet("Profiles").Cell(2, 1).GetString().Should().Be("Export Tester");
    }

    [Fact]
    public async Task TripsSheet_CarriesStatusEstimateSpendSavingsAndBudget()
    {
        await SeedAsync();
        using var workbook = await ExportAsync();
        var sheet = workbook.Worksheet("Trips");
        var col = Columns(sheet);
        var rows = sheet.RowsUsed().Skip(1).ToList();

        var done = rows.Single(r => r.Cell(col["Trip"]).GetString() == "Big shop");
        done.Cell(col["Status"]).GetString().Should().Be("Done");
        done.Cell(col["Items"]).GetDouble().Should().Be(2);
        done.Cell(col["Picked Up"]).GetDouble().Should().Be(2);
        done.Cell(col["Budget"]).GetDouble().Should().Be(20);
        done.Cell(col["Estimated"]).GetDouble().Should().Be(9);
        done.Cell(col["Spent"]).GetDouble().Should().BeApproximately(8.99, 1e-9);
        done.Cell(col["Savings"]).GetDouble().Should().BeApproximately(0.01, 1e-9);
        done.Cell(col["Budget Left"]).GetDouble().Should().BeApproximately(11.01, 1e-9);
        done.Cell(col["Completed"]).IsEmpty().Should().BeFalse();

        // A plan has nothing to compare yet: no estimate, no savings, nothing completed.
        var planned = rows.Single(r => r.Cell(col["Trip"]).GetString() == "Weekly stock-up");
        planned.Cell(col["Status"]).GetString().Should().Be("Planned");
        planned.Cell(col["Spent"]).GetDouble().Should().Be(0);
        planned.Cell(col["Estimated"]).IsEmpty().Should().BeTrue();
        planned.Cell(col["Savings"]).IsEmpty().Should().BeTrue();
        planned.Cell(col["Completed"]).IsEmpty().Should().BeTrue();
    }

    [Fact]
    public async Task TripItemsSheet_HasOneRowPerLine_WithEstimateAndPrice()
    {
        await SeedAsync();
        using var workbook = await ExportAsync();
        var sheet = workbook.Worksheet("Trip Items");
        var col = Columns(sheet);
        var rows = sheet.RowsUsed().Skip(1).ToList();
        rows.Should().HaveCount(3);

        var bought = rows.Single(r => r.Cell(col["Item"]).GetString() == "Whole Milk");
        bought.Cell(col["Picked Up"]).GetBoolean().Should().BeTrue();
        bought.Cell(col["Estimate"]).GetDouble().Should().Be(4);
        bought.Cell(col["Price"]).GetDouble().Should().Be(3.49);
        bought.Cell(col["Priced"]).IsEmpty().Should().BeFalse();
        bought.Cell(col["Price Locked"]).GetBoolean().Should().BeFalse();

        // The planned item lands in the same sheet, unticked and with no price.
        var planned = rows.Single(r => r.Cell(col["Item"]).GetString() == "Bananas");
        planned.Cell(col["Trip"]).GetString().Should().Be("Weekly stock-up");
        planned.Cell(col["Status"]).GetString().Should().Be("Planned");
        planned.Cell(col["Picked Up"]).GetBoolean().Should().BeFalse();
        planned.Cell(col["Price"]).IsEmpty().Should().BeTrue();
    }

    [Fact]
    public async Task IncludeItems_AddsTheCatalogueWithPriceStatistics()
    {
        var (profileId, dairyId) = await SeedAsync();
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            TestTrips.At("2026-08-10", "Aldi", TestTrips.Bought("Whole Milk", dairyId, 4.51m)));

        using var workbook = await ExportAsync("?includeItems=true");

        workbook.Worksheets.Select(w => w.Name).Should().Equal("Profiles", "Trips", "Trip Items", "Items");
        var sheet = workbook.Worksheet("Items");
        var col = Columns(sheet);
        var rows = sheet.RowsUsed().Skip(1).ToList();
        rows.Select(r => r.Cell(col["Item"]).GetString()).Should().Equal("Bananas", "Butter", "Whole Milk");

        var milk = rows.Single(r => r.Cell(col["Item"]).GetString() == "Whole Milk");
        milk.Cell(col["Default Category"]).GetString().Should().Be("Dairy");
        milk.Cell(col["Purchases"]).GetDouble().Should().Be(2);
        milk.Cell(col["Average Price"]).GetDouble().Should().Be(4);
        milk.Cell(col["Last Price"]).GetDouble().Should().Be(4.51);
        milk.Cell(col["Lowest"]).GetDouble().Should().Be(3.49);
        milk.Cell(col["Highest"]).GetDouble().Should().Be(4.51);
        milk.Cell(col["First Bought"]).GetString().Should().Be("2026-08-01");
        milk.Cell(col["Last Bought"]).GetString().Should().Be("2026-08-10");

        // Listed but never bought: counted, with no price statistics.
        var bananas = rows.Single(r => r.Cell(col["Item"]).GetString() == "Bananas");
        bananas.Cell(col["Times Listed"]).GetDouble().Should().Be(1);
        bananas.Cell(col["Purchases"]).GetDouble().Should().Be(0);
        bananas.Cell(col["Average Price"]).IsEmpty().Should().BeTrue();
    }

    [Fact]
    public async Task Export_WithNoData_StillReturnsValidWorkbook()
    {
        using var workbook = await ExportAsync("?includeItems=true");
        workbook.Worksheets.Select(w => w.Name).Should().Equal("Profiles", "Trips", "Trip Items", "Items");
    }
}
