using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using FluentAssertions;
using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Tests;

// The real reader's request and reply handling, against a fake HTTP endpoint (no network).
public class AnthropicReceiptReaderTests
{
    private sealed class FakeHandler(Func<HttpRequestMessage, string, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public JsonNode? LastBody { get; private set; }
        public HttpRequestMessage? LastRequest { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = await request.Content!.ReadAsStringAsync(ct);
            LastBody = JsonNode.Parse(body);
            LastRequest = request;
            return respond(request, body);
        }
    }

    // A structured-output reply: an (empty, as by default) thinking block, then the JSON as text.
    private static HttpResponseMessage Reply(string json, string stopReason = "end_turn") => new(HttpStatusCode.OK)
    {
        Content = new StringContent(new JsonObject
        {
            ["stop_reason"] = stopReason,
            ["content"] = new JsonArray { new JsonObject { ["type"] = "thinking", ["thinking"] = "" }, new JsonObject { ["type"] = "text", ["text"] = json } },
        }.ToJsonString(), Encoding.UTF8, "application/json"),
    };

    // Structured outputs need every object closed; nullable fields use anyOf, not type arrays.
    private static void ShouldBeAStrictSchema(JsonNode node)
    {
        if (node is JsonObject obj)
        {
            if (obj["type"]?.GetValueKind() == System.Text.Json.JsonValueKind.Array) throw new Xunit.Sdk.XunitException($"type array in {obj.ToJsonString()}");
            if (obj["type"]?.GetValue<string>() == "object") obj["additionalProperties"]?.GetValue<bool>().Should().BeFalse($"{obj.ToJsonString()} must be closed");
            foreach (var (_, child) in obj) if (child is not null) ShouldBeAStrictSchema(child);
        }
        else if (node is JsonArray arr) foreach (var child in arr) if (child is not null) ShouldBeAStrictSchema(child);
    }

    private static ReceiptOptions Options(string? key = "test-key") => new() { ApiKey = key, Model = "claude-sonnet-5-5", Endpoint = "https://example.test/v1/messages" };

    [Fact]
    public async Task ReadImage_SendsThePhotoWithAStructuredOutputSchema_AndParsesTheReply()
    {
        var handler = new FakeHandler((_, _) => Reply("""
            {"store":"ALDI","date":"2024-03-15","subtotal":5.5,"tax":0,"total":5.5,
             "lines":[{"text":"Peanut Butter SWC","code":null,"name":"Peanut Butter","quantity":2,"unit":"each","unitPrice":2.75,"amount":5.5,"discount":null,"kind":"item"}]}
            """));
        var reader = new AnthropicReceiptReader(new HttpClient(handler), Options());

        var reading = await reader.ReadImageAsync([1, 2, 3], "image/jpeg", ["Produce", "Dairy"], null, CancellationToken.None);

        reading.Store.Should().Be("ALDI");
        reading.Lines.Should().ContainSingle(l => l.Quantity == 2 && l.UnitPrice == 2.75m && l.Amount == 5.5m);
        handler.LastRequest!.Headers.GetValues("x-api-key").Should().Equal("test-key");
        handler.LastRequest.Headers.GetValues("anthropic-version").Should().Equal("2023-06-01");
        var body = handler.LastBody!;
        body["model"]!.GetValue<string>().Should().Be("claude-sonnet-5-5");
        // Forced tool use is a 400 on Claude Sonnet 5.5 and later: the schema goes in output_config instead.
        body["tool_choice"].Should().BeNull();
        body["tools"].Should().BeNull();
        body["output_config"]!["format"]!["type"]!.GetValue<string>().Should().Be("json_schema");
        ShouldBeAStrictSchema(body["output_config"]!["format"]!["schema"]!);
        var image = body["messages"]![0]!["content"]![0]!;
        (image["source"]!["media_type"]!.GetValue<string>(), image["source"]!["data"]!.GetValue<string>()).Should().Be(("image/jpeg", "AQID"));
        body["messages"]![0]!["content"]![1]!["text"]!.GetValue<string>().Should().Contain("The household's categories: Produce, Dairy.");
    }

    [Fact]
    public async Task Choose_ReturnsOnlyValidPicks()
    {
        var handler = new FakeHandler((_, _) => Reply("""{"choices":[{"line":0,"candidate":1},{"line":1,"candidate":null},{"line":2,"candidate":9}]}"""));
        var reader = new AnthropicReceiptReader(new HttpClient(handler), Options());

        var picks = await reader.ChooseAsync(
            [("REDCD SODIUM BROTH", null, ["Beef Broth", "Reduced Sodium Chicken Broth"]), ("3D KITE", null, ["Kiwi"]), ("X", null, ["A"])],
            CancellationToken.None);

        picks.Should().Equal(1, null, null);
        handler.LastBody!["messages"]![0]!["content"]![0]!["text"]!.GetValue<string>().Should().Contain("Line 0: \"REDCD SODIUM BROTH\"").And.Contain("1: Reduced Sodium Chicken Broth");
        handler.LastBody["tool_choice"].Should().BeNull();
        ShouldBeAStrictSchema(handler.LastBody["output_config"]!["format"]!["schema"]!);
    }

    [Fact]
    public async Task Failures_BecomeReadErrors_AndNoKeyMeansNotConfigured()
    {
        var failing = new AnthropicReceiptReader(new HttpClient(new FakeHandler((_, _) => new HttpResponseMessage(HttpStatusCode.TooManyRequests))), Options());
        await failing.Invoking(r => r.ReadTextAsync("x", [], null, CancellationToken.None)).Should().ThrowAsync<ReceiptReadException>().WithMessage("*429*");

        // The API's reason comes through, so the failure says what to fix.
        var rejected = new AnthropicReceiptReader(new HttpClient(new FakeHandler((_, _) => new HttpResponseMessage(HttpStatusCode.BadRequest)
        {
            Content = new StringContent("""{"type":"error","error":{"type":"invalid_request_error","message":"tool_choice: type \"tool\" and \"any\" are not supported for this model."}}"""),
        })), Options());
        await rejected.Invoking(r => r.ReadTextAsync("x", [], null, CancellationToken.None)).Should().ThrowAsync<ReceiptReadException>()
            .WithMessage("The receipt reader returned 400: tool_choice: type \"tool\" and \"any\" are not supported for this model.");

        var notJson = new AnthropicReceiptReader(new HttpClient(new FakeHandler((_, _) => Reply("hi"))), Options());
        await notJson.Invoking(r => r.ReadTextAsync("x", [], null, CancellationToken.None)).Should().ThrowAsync<ReceiptReadException>();

        // A refusal or a cut-off reply may not match the schema, so neither is read as an answer.
        var refused = new AnthropicReceiptReader(new HttpClient(new FakeHandler((_, _) => Reply("""{"lines":[]}""", "refusal"))), Options());
        await refused.Invoking(r => r.ReadTextAsync("x", [], null, CancellationToken.None)).Should().ThrowAsync<ReceiptReadException>().WithMessage("*declined*");
        var cutOff = new AnthropicReceiptReader(new HttpClient(new FakeHandler((_, _) => Reply("""{"lines":[""", "max_tokens"))), Options());
        await cutOff.Invoking(r => r.ReadTextAsync("x", [], null, CancellationToken.None)).Should().ThrowAsync<ReceiptReadException>().WithMessage("*too long*");

        new AnthropicReceiptReader(new HttpClient(), Options(null)).Configured.Should().BeFalse();
    }
}
