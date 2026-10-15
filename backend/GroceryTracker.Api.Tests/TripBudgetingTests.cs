using System.Net;
using System.Text.Json;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Estimates, savings, trip status and the price lock. The clock is fixed and moved
// forward by hand so the 7-day edit window can be crossed inside one test.
public class TripBudgetingTests : IDisposable
{
    private static readonly DateTimeOffset Start = new(2026, 8, 5, 15, 0, 0, TimeSpan.Zero);

    private readonly GroceryTrackerApiFactory _factory = new(Start);
    private readonly HttpClient _client;

    public TripBudgetingTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private FakeClock Clock => _factory.Clock!;

    private async Task<Guid> CreateProfileAsync() =>
        (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Budgeter")))
            .ReadAsAsync<ProfileDto>())!.Id;

    private async Task<Guid> GetCategoryIdAsync(string name) =>
        (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!
            .First(c => c.Name == name).Id;

    // What the editor sends back: every line with its id, as it was loaded.
    private static TripInput ToInput(TripDto trip) => new(
        trip.Name, trip.Date, trip.Budget, trip.Stores,
        trip.Items.Select(i => new TripItemInput(i.ItemName, i.CategoryId, i.StoreName, i.Checked, i.Price, i.Estimate, i.Id)).ToList(),
        trip.Status);

    private async Task<TripDto> PutAsync(Guid profileId, Guid tripId, TripInput input)
    {
        var response = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{tripId}", input);
        response.IsSuccessStatusCode.Should().BeTrue(await response.Content.ReadAsStringAsync());
        return (await response.ReadAsAsync<TripDto>())!;
    }

    private static async Task<string?> ProblemTypeAsync(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.TryGetProperty("type", out var type) ? type.GetString() : null;
    }

    [Fact]
    public async Task Estimates_RoundTrip_AndDriveEstimatedTotalAndSavings()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");

        var trip = await PutAsync(profileId, Guid.NewGuid(), new TripInput("Shop", "2026-08-05", 20m, ["Aldi"],
        [
            new TripItemInput("Whole Milk", dairyId, "Aldi", true, 3.00m, Estimate: 4.00m),
            new TripItemInput("Butter", dairyId, "Aldi", true, 5.50m, Estimate: 5.00m),
            // Estimated but not bought yet: counts toward the estimate, not the savings.
            new TripItemInput("Cheese", dairyId, "Aldi", false, null, Estimate: 6.00m),
            // Bought with no estimate: counts toward spend, not the savings.
            new TripItemInput("Yogurt", dairyId, "Aldi", true, 2.00m),
        ]));

        trip.Items.Single(i => i.ItemName == "Cheese").Estimate.Should().Be(6.00m);
        trip.EstimatedTotal.Should().Be(15.00m);
        trip.Total.Should().Be(10.50m);
        // (4.00 - 3.00) + (5.00 - 5.50): only lines with both an estimate and a price.
        trip.Savings.Should().Be(0.50m);

        var summary = (await (await _client.GetAsync($"/api/v1/profiles/{profileId}/trips"))
            .ReadAsAsync<List<TripSummaryDto>>())!.Single();
        summary.EstimatedTotal.Should().Be(15.00m);
        summary.Savings.Should().Be(0.50m);
    }

    [Fact]
    public async Task Savings_IsNull_WhenNoLineHasBothEstimateAndPrice_AndNegativeWhenOver()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");
        var tripId = Guid.NewGuid();

        var planned = await PutAsync(profileId, tripId, new TripInput(null, "2026-08-05", null, [],
            [new TripItemInput("Whole Milk", dairyId, null, false, null, Estimate: 3.00m)]));
        planned.Savings.Should().BeNull();

        var over = await PutAsync(profileId, tripId, ToInput(planned) with
        {
            Items = [new TripItemInput("Whole Milk", dairyId, null, true, 3.75m, 3.00m, planned.Items[0].Id)],
        });
        over.Savings.Should().Be(-0.75m);
    }

    [Fact]
    public async Task ItemSearch_ReportsAveragePrice_AndNullForUntrackedItems()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");

        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            TestTrips.At("2026-07-01", "Costco", TestTrips.Bought("Whole Milk", dairyId, 3.00m)));
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            TestTrips.At("2026-08-01", "Safeway", TestTrips.Bought("Whole Milk", dairyId, 4.25m)));
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("Plan", "2026-08-05", null, [], [TestTrips.Planned("Saffron", dairyId)]));

        var items = await (await _client.GetAsync($"/api/v1/items")).ReadAsAsync<List<ItemDto>>();

        items!.Single(i => i.Name == "Whole Milk").AveragePrice.Should().Be(3.63m); // 3.625 rounded
        items!.Single(i => i.Name == "Saffron").AveragePrice.Should().BeNull();
    }

    [Fact]
    public async Task Status_DefaultsToPlanned_StampsCompletedAtOnDone_AndClearsItOnReopen()
    {
        var profileId = await CreateProfileAsync();
        var tripId = Guid.NewGuid();

        var trip = await PutAsync(profileId, tripId, new TripInput(null, "2026-08-05", null, [], []));
        trip.Status.Should().Be("planned");
        trip.CompletedAt.Should().BeNull();

        // A save that doesn't mention status leaves it alone.
        trip = await PutAsync(profileId, tripId, ToInput(trip) with { Status = "shopping" });
        trip = await PutAsync(profileId, tripId, ToInput(trip) with { Status = null });
        trip.Status.Should().Be("shopping");

        trip = await PutAsync(profileId, tripId, ToInput(trip) with { Status = "done" });
        trip.Status.Should().Be("done");
        trip.CompletedAt.Should().Be(Start);

        // Saving a finished trip again keeps when it was first finished.
        Clock.Advance(TimeSpan.FromHours(2));
        trip = await PutAsync(profileId, tripId, ToInput(trip));
        trip.CompletedAt.Should().Be(Start);

        trip = await PutAsync(profileId, tripId, ToInput(trip) with { Status = "shopping" });
        trip.CompletedAt.Should().BeNull();
    }

    [Fact]
    public async Task Status_Invalid_IsRejected()
    {
        var profileId = await CreateProfileAsync();

        var response = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{Guid.NewGuid()}",
            new TripInput(null, "2026-08-05", null, [], [], Status: "abandoned"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ProblemTypeAsync(response)).Should().Be(ProblemTypes.Validation);
    }

    [Fact]
    public async Task Price_IsEditableForSevenDays_ThenTheLineIsReadOnly()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");
        var tripId = Guid.NewGuid();

        var trip = await PutAsync(profileId, tripId, new TripInput(null, "2026-08-05", null, ["Aldi"],
            [new TripItemInput("Whole Milk", dairyId, "Aldi", true, 3.00m)]));
        trip.Items[0].PriceLocked.Should().BeFalse();
        trip.Items[0].PriceLocksAt.Should().Be(Start.AddDays(7));

        // Day 6: a correction is fine, and doesn't restart the window.
        Clock.Advance(TimeSpan.FromDays(6));
        trip = await PutAsync(profileId, tripId, ToInput(trip) with
        {
            Items = [new TripItemInput("Whole Milk", dairyId, "Aldi", true, 3.25m, Id: trip.Items[0].Id)],
        });
        trip.Items[0].Price.Should().Be(3.25m);
        trip.Items[0].PriceLocksAt.Should().Be(Start.AddDays(7));

        // Day 8: locked.
        Clock.Advance(TimeSpan.FromDays(2));
        trip = (await (await _client.GetAsync($"/api/v1/profiles/{profileId}/trips/{tripId}")).ReadAsAsync<TripDto>())!;
        trip.Items[0].PriceLocked.Should().BeTrue();

        var changePrice = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{tripId}", ToInput(trip) with
        {
            Items = [new TripItemInput("Whole Milk", dairyId, "Aldi", true, 2.00m, Id: trip.Items[0].Id)],
        });
        changePrice.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await ProblemTypeAsync(changePrice)).Should().Be(ProblemTypes.PriceLocked);

        var removeLine = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{tripId}", ToInput(trip) with { Items = [] });
        removeLine.StatusCode.Should().Be(HttpStatusCode.Conflict);

        // Everything else on the trip can still change, as long as the locked line comes back as-is.
        var edited = await PutAsync(profileId, tripId, ToInput(trip) with
        {
            Name = "Renamed",
            Items = [.. ToInput(trip).Items, TestTrips.Planned("Butter", dairyId)],
        });
        edited.Name.Should().Be("Renamed");
        edited.Items.Should().HaveCount(2);
        edited.Items.Single(i => i.ItemName == "Whole Milk").Should().BeEquivalentTo(trip.Items[0]);
    }

    [Fact]
    public async Task LockedLine_SentWithoutId_IsMatchedByName()
    {
        // Payloads queued offline by an older client carry no line ids.
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");
        var tripId = Guid.NewGuid();

        var input = new TripInput(null, "2026-08-05", null, ["Aldi"], [new TripItemInput("Whole Milk", dairyId, "Aldi", true, 3.00m)]);
        var trip = await PutAsync(profileId, tripId, input);

        Clock.Advance(TimeSpan.FromDays(10));
        var again = await PutAsync(profileId, tripId, input with { Name = "Same lines, no ids" });

        again.Items.Single().Id.Should().Be(trip.Items.Single().Id);
        again.Items.Single().PriceLocked.Should().BeTrue();
    }

    [Fact]
    public async Task ClearingAPrice_BeforeTheLock_ResetsTheWindow()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");
        var tripId = Guid.NewGuid();

        var trip = await PutAsync(profileId, tripId, new TripInput(null, "2026-08-05", null, [],
            [new TripItemInput("Whole Milk", dairyId, null, true, 3.00m)]));

        Clock.Advance(TimeSpan.FromDays(3));
        trip = await PutAsync(profileId, tripId, ToInput(trip) with
        {
            Items = [new TripItemInput("Whole Milk", dairyId, null, false, null, Id: trip.Items[0].Id)],
        });
        trip.Items[0].PriceLocksAt.Should().BeNull();

        trip = await PutAsync(profileId, tripId, ToInput(trip) with
        {
            Items = [new TripItemInput("Whole Milk", dairyId, null, true, 3.10m, Id: trip.Items[0].Id)],
        });
        trip.Items[0].PriceLocksAt.Should().Be(Start.AddDays(10));
    }
}
