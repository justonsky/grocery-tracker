using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Core.Services;

// Turns a receipt photo (or pasted text) into a ReceiptReading, and picks the most likely
// household item for lines it can't place. The real one is a cloud vision model; tests use a
// fixture. Configured under "Receipts" (see ReceiptOptions).
public interface IReceiptReader
{
    bool Configured { get; }
    // categories: the household's category names, for the reader to sort each product into.
    Task<ReceiptReading> ReadImageAsync(byte[] image, string contentType, IReadOnlyList<string> categories, string? fixture, CancellationToken ct);
    Task<ReceiptReading> ReadTextAsync(string text, IReadOnlyList<string> categories, string? fixture, CancellationToken ct);
    // For each line, the index of the candidate it is (or null). Lines and candidates are in order.
    Task<List<int?>> ChooseAsync(List<(string Text, string? Name, List<string> Candidates)> lines, CancellationToken ct);
}

public class ReceiptOptions
{
    // "anthropic" (default) or "fixture" (tests / demos: reads Fixture JSON files by name).
    public string Reader { get; set; } = "anthropic";
    public string? ApiKey { get; set; }
    public string Model { get; set; } = "claude-sonnet-5-5";
    public string Endpoint { get; set; } = "https://api.anthropic.com/v1/messages";
    public string? FixtureDir { get; set; }
    // Each read is a paid API call and anyone on the network can send one, so they're capped.
    public int ReadsPerHour { get; set; } = 30;
}

public class ReceiptReadException(string message, Exception? inner = null) : Exception(message, inner);

// Claude via the Messages API: the image goes up once with a structured-output schema (the
// ReceiptReading), so the reply is JSON, not prose. Only those fields are kept. Not a forced tool
// call: Claude Sonnet 5.5 and later answer tool_choice "tool"/"any" with a 400.
public class AnthropicReceiptReader(HttpClient http, ReceiptOptions options) : IReceiptReader
{
    public bool Configured => !string.IsNullOrWhiteSpace(options.ApiKey);

    internal const string Instructions = """
        Read this grocery store receipt and record it.
        - One line per product bought, in printed order. "text" is the description exactly as printed (without the price);
          "code" is the item number printed with it, if any; "name" is a plain product name with abbreviations expanded
          (e.g. "Redcd Sodium Broth" -> "Reduced Sodium Broth"), or null if you can't tell.
        - "amount" is what the line cost. "2 @ 2.75" means quantity 2 at unit price 2.75. For weighed items
          ("1.55 lb x 1.45/lb"), quantity is the weight (use the net "(N)" weight when gross/tare are printed) and unit is
          lb, oz, kg or g; otherwise unit is "each".
        - A coupon or discount printed under an item (e.g. "CPN-PIRATE36 1.00-") is that item's "discount": subtract it
          from the item's amount and do not list it separately.
        - Tax lines are kind "tax", bottle deposits "deposit", delivery or bag fees "fee", tips "tip"; products are "item".
        - Leave out subtotals, totals, payment and tender lines (cash, cards, "Awards", "Rewards", change), savings
          summaries, card numbers, membership numbers and anything handwritten.
        - "category" is one of the household's categories listed below, for products only (null if none fits).
        - "store" is the chain's name as printed (e.g. "ALDI", "BJ's"); "date" is YYYY-MM-DD; "subtotal", "tax" (all tax
          lines added up) and "total" are as printed — use null for anything you can't read.
        """;

    private static readonly JsonObject ReceiptSchema = JsonNode.Parse("""
        {
          "type": "object",
          "properties": {
            "store": { "anyOf": [{ "type": "string" }, { "type": "null" }] },
            "date": { "anyOf": [{ "type": "string" }, { "type": "null" }], "description": "YYYY-MM-DD" },
            "subtotal": { "anyOf": [{ "type": "number" }, { "type": "null" }] },
            "tax": { "anyOf": [{ "type": "number" }, { "type": "null" }] },
            "total": { "anyOf": [{ "type": "number" }, { "type": "null" }] },
            "lines": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "text": { "type": "string" },
                  "code": { "anyOf": [{ "type": "string" }, { "type": "null" }] },
                  "name": { "anyOf": [{ "type": "string" }, { "type": "null" }] },
                  "quantity": { "type": "number" },
                  "unit": { "type": "string", "enum": ["each", "lb", "oz", "kg", "g"] },
                  "unitPrice": { "anyOf": [{ "type": "number" }, { "type": "null" }] },
                  "amount": { "type": "number" },
                  "discount": { "anyOf": [{ "type": "number" }, { "type": "null" }] },
                  "kind": { "type": "string", "enum": ["item", "tax", "fee", "tip", "deposit"] },
                  "category": { "anyOf": [{ "type": "string" }, { "type": "null" }] }
                },
                "required": ["text", "quantity", "unit", "amount", "kind"],
                "additionalProperties": false
              }
            }
          },
          "required": ["lines"],
          "additionalProperties": false
        }
        """)!.AsObject();

    private static readonly JsonObject ChooseSchema = JsonNode.Parse("""
        {
          "type": "object",
          "properties": {
            "choices": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": { "line": { "type": "integer" }, "candidate": { "anyOf": [{ "type": "integer" }, { "type": "null" }] } },
                "required": ["line", "candidate"],
                "additionalProperties": false
              }
            }
          },
          "required": ["choices"],
          "additionalProperties": false
        }
        """)!.AsObject();

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static string WithCategories(IReadOnlyList<string> categories) =>
        Instructions + "\nThe household's categories: " + string.Join(", ", categories) + ".";

    public Task<ReceiptReading> ReadImageAsync(byte[] image, string contentType, IReadOnlyList<string> categories, string? fixture, CancellationToken ct) =>
        ReadAsync(new JsonArray
        {
            new JsonObject { ["type"] = "image", ["source"] = new JsonObject { ["type"] = "base64", ["media_type"] = contentType, ["data"] = Convert.ToBase64String(image) } },
            new JsonObject { ["type"] = "text", ["text"] = WithCategories(categories) },
        }, ct);

    public Task<ReceiptReading> ReadTextAsync(string text, IReadOnlyList<string> categories, string? fixture, CancellationToken ct) =>
        ReadAsync(new JsonArray
        {
            new JsonObject { ["type"] = "text", ["text"] = WithCategories(categories) + "\n\nThe receipt, as text:\n\n" + text },
        }, ct);

    private async Task<ReceiptReading> ReadAsync(JsonArray content, CancellationToken ct)
    {
        // Room for the thinking the model does first (adaptive thinking counts toward max_tokens) and a long receipt.
        var input = await CallJsonAsync(ReceiptSchema, content, 16000, ct);
        try
        {
            return input.Deserialize<ReceiptReading>(Json) ?? throw new ReceiptReadException("The receipt came back empty.");
        }
        catch (JsonException e)
        {
            throw new ReceiptReadException("The receipt couldn't be read.", e);
        }
    }

    public async Task<List<int?>> ChooseAsync(List<(string Text, string? Name, List<string> Candidates)> lines, CancellationToken ct)
    {
        var prompt = new StringBuilder("""
            Each numbered receipt line below is a product bought at a grocery store. Choose which of its numbered
            candidates (items from the household's own list) it is, or null if none of them is the same product.
            Give one choice per line.

            """);
        for (var i = 0; i < lines.Count; i++)
        {
            prompt.Append($"Line {i}: \"{lines[i].Text}\"{(lines[i].Name is { } n ? $" (probably: {n})" : "")}\n");
            for (var c = 0; c < lines[i].Candidates.Count; c++) prompt.Append($"  {c}: {lines[i].Candidates[c]}\n");
        }
        var input = await CallJsonAsync(ChooseSchema,
            new JsonArray { new JsonObject { ["type"] = "text", ["text"] = prompt.ToString() } }, 8000, ct);
        var result = Enumerable.Repeat<int?>(null, lines.Count).ToList();
        foreach (var choice in input["choices"]?.AsArray() ?? [])
        {
            var line = choice?["line"]?.GetValue<int>();
            var candidate = choice?["candidate"] is JsonValue v && v.TryGetValue<int>(out var c) ? c : (int?)null;
            if (line is >= 0 && line < lines.Count && candidate is >= 0 && candidate < lines[line.Value].Candidates.Count)
                result[line.Value] = candidate;
        }
        return result;
    }

    private async Task<JsonNode> CallJsonAsync(JsonObject schema, JsonArray content, int maxTokens, CancellationToken ct)
    {
        if (!Configured) throw new ReceiptReadException("Receipt reading isn't set up on the server.");
        var body = new JsonObject
        {
            ["model"] = options.Model,
            ["max_tokens"] = maxTokens,
            ["output_config"] = new JsonObject { ["format"] = new JsonObject { ["type"] = "json_schema", ["schema"] = schema.DeepClone() } },
            ["messages"] = new JsonArray { new JsonObject { ["role"] = "user", ["content"] = content } },
        };
        using var request = new HttpRequestMessage(HttpMethod.Post, options.Endpoint)
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("x-api-key", options.ApiKey);
        request.Headers.Add("anthropic-version", "2023-06-01");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, ct);
        }
        catch (HttpRequestException e)
        {
            throw new ReceiptReadException("Couldn't reach the receipt reader. Check the server's internet connection.", e);
        }
        using (response)
        {
            var text = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode)
                throw new ReceiptReadException($"The receipt reader returned {(int)response.StatusCode}{ErrorDetail(text)}.");
            var reply = JsonNode.Parse(text);
            // A refusal or a cut-off reply can stop short of the schema, so it isn't parsed as an answer.
            switch (reply?["stop_reason"]?.GetValue<string>())
            {
                case "refusal": throw new ReceiptReadException("The receipt reader declined to read this receipt.");
                case "max_tokens": throw new ReceiptReadException("The receipt was too long to read in one go.");
            }
            var json = reply?["content"]?.AsArray().FirstOrDefault(c => c?["type"]?.GetValue<string>() == "text")?["text"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(json)) throw new ReceiptReadException("The receipt reader gave no answer.");
            try
            {
                return JsonNode.Parse(json) ?? throw new ReceiptReadException("The receipt reader gave no answer.");
            }
            catch (JsonException e)
            {
                throw new ReceiptReadException("The receipt reader's answer couldn't be read.", e);
            }
        }
    }

    // The API's own reason for an error ("…is not supported for this model"), so a failure says what
    // to fix instead of a bare status code. It never carries the key or the receipt.
    private static string ErrorDetail(string body)
    {
        try
        {
            var message = JsonNode.Parse(body)?["error"]?["message"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(message)) return "";
            message = message.Trim();
            return ": " + (message.Length > 200 ? message[..200] + "…" : message.TrimEnd('.'));
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException)
        {
            return "";
        }
    }
}

// Tests and demos: returns <FixtureDir>/<fixture>.json for whatever image or text is sent, and
// picks the best-scoring candidate when it scores well. Never used unless Receipts:Reader=fixture.
public class FixtureReceiptReader(ReceiptOptions options) : IReceiptReader
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public bool Configured => !string.IsNullOrWhiteSpace(options.FixtureDir);

    public Task<ReceiptReading> ReadImageAsync(byte[] image, string contentType, IReadOnlyList<string> categories, string? fixture, CancellationToken ct) => LoadAsync(fixture, ct);
    public Task<ReceiptReading> ReadTextAsync(string text, IReadOnlyList<string> categories, string? fixture, CancellationToken ct) => LoadAsync(fixture, ct);

    private async Task<ReceiptReading> LoadAsync(string? fixture, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(fixture) || fixture.Any(c => !char.IsLetterOrDigit(c) && c != '-'))
            throw new ReceiptReadException("No receipt fixture named.");
        var path = Path.Combine(options.FixtureDir!, fixture + ".json");
        if (!File.Exists(path)) throw new ReceiptReadException($"No receipt fixture '{fixture}'.");
        return JsonSerializer.Deserialize<ReceiptReading>(await File.ReadAllTextAsync(path, ct), Json)!;
    }

    public Task<List<int?>> ChooseAsync(List<(string Text, string? Name, List<string> Candidates)> lines, CancellationToken ct) =>
        Task.FromResult(lines.Select(l =>
        {
            var scored = l.Candidates.Select((c, i) => (i, s: Math.Max(ItemNameMatcher.Score(l.Text, c), l.Name is null ? 0 : ItemNameMatcher.Score(l.Name, c))))
                .OrderByDescending(x => x.s).FirstOrDefault();
            return l.Candidates.Count > 0 && scored.s >= 0.6 ? (int?)scored.i : null;
        }).ToList());
}
