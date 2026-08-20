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

    [Fact]
    public async Task ExportXlsx_ContainsProfilesAndTripsSheets()
    {
        var profileId = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Export Tester")))
            .ReadAsAsync<ProfileDto>())!.Id;
        var categoryId = (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!
            .First(c => c.Name == "Dairy").Id;

        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            TestTrips.At("2026-08-01", "Costco", TestTrips.Bought("Whole Milk", categoryId, 3.49m)));
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("Weekly stock-up", "2026-08-02", null, [], [TestTrips.Planned("Bananas", categoryId)]));

        var response = await _client.GetAsync("/api/v1/export/data.xlsx");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.Should()
            .Be("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

        var bytes = await response.Content.ReadAsByteArrayAsync();
        using var stream = new MemoryStream(bytes);
        using var workbook = new XLWorkbook(stream);

        // Lists and trips are one thing now, so one sheet carries both.
        workbook.Worksheets.Select(w => w.Name).Should().BeEquivalentTo(["Profiles", "Trips"]);

        var profilesSheet = workbook.Worksheet("Profiles");
        profilesSheet.Cell(2, 1).GetString().Should().Be("Export Tester");

        // Columns: Profile, Date, Trip, Trip Stores, Budget, Item, Category, Store, Picked Up, Price
        var tripsSheet = workbook.Worksheet("Trips");
        var rows = tripsSheet.RowsUsed().Skip(1).ToList();

        var bought = rows.Single(r => r.Cell(6).GetString() == "Whole Milk");
        bought.Cell(9).GetBoolean().Should().BeTrue();
        bought.Cell(10).GetDouble().Should().Be(3.49);

        // The planned item lands in the same sheet, unticked and with no price.
        var planned = rows.Single(r => r.Cell(6).GetString() == "Bananas");
        planned.Cell(3).GetString().Should().Be("Weekly stock-up");
        planned.Cell(9).GetBoolean().Should().BeFalse();
        planned.Cell(10).IsEmpty().Should().BeTrue();
    }

    [Fact]
    public async Task ExportXlsx_WithNoData_StillReturnsValidWorkbook()
    {
        var response = await _client.GetAsync("/api/v1/export/data.xlsx");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var bytes = await response.Content.ReadAsByteArrayAsync();
        using var stream = new MemoryStream(bytes);
        using var workbook = new XLWorkbook(stream);
        // Lists and trips are one thing now, so one sheet carries both.
        workbook.Worksheets.Select(w => w.Name).Should().BeEquivalentTo(["Profiles", "Trips"]);
    }
}
