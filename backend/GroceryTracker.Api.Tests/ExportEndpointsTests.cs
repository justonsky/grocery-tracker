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
    public async Task ExportXlsx_ContainsProfilesTripsAndListsSheets()
    {
        var profileId = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Export Tester")))
            .ReadAsAsync<ProfileDto>())!.Id;
        var categoryId = (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!
            .First(c => c.Name == "Dairy").Id;

        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("2026-08-01", "Costco", [new TripItemInput("Whole Milk", categoryId, 3.49m)]));
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/lists",
            new GroceryListInput("Weekly stock-up", null, [], [new ListItemInput("Bananas", categoryId, null, false)]));

        var response = await _client.GetAsync("/api/v1/export/data.xlsx");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.Should()
            .Be("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

        var bytes = await response.Content.ReadAsByteArrayAsync();
        using var stream = new MemoryStream(bytes);
        using var workbook = new XLWorkbook(stream);

        workbook.Worksheets.Select(w => w.Name).Should().BeEquivalentTo(["Profiles", "Trips", "Lists"]);

        var profilesSheet = workbook.Worksheet("Profiles");
        profilesSheet.Cell(2, 1).GetString().Should().Be("Export Tester");

        var tripsSheet = workbook.Worksheet("Trips");
        tripsSheet.Cell(2, 4).GetString().Should().Be("Whole Milk");
        tripsSheet.Cell(2, 6).GetDouble().Should().Be(3.49);

        var listsSheet = workbook.Worksheet("Lists");
        listsSheet.Cell(2, 4).GetString().Should().Be("Bananas");
    }

    [Fact]
    public async Task ExportXlsx_WithNoData_StillReturnsValidWorkbook()
    {
        var response = await _client.GetAsync("/api/v1/export/data.xlsx");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var bytes = await response.Content.ReadAsByteArrayAsync();
        using var stream = new MemoryStream(bytes);
        using var workbook = new XLWorkbook(stream);
        workbook.Worksheets.Select(w => w.Name).Should().BeEquivalentTo(["Profiles", "Trips", "Lists"]);
    }
}
