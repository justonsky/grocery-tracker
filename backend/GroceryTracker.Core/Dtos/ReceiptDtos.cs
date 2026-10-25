namespace GroceryTracker.Core.Dtos;

// What the reader (the vision model, or a fixture in tests) makes of a receipt. Amount is what a
// line cost after any coupon printed under it; tender lines, card and membership numbers are never
// included. Total is null when it isn't visible.
// Readable false = the reader saw no legible receipt (a blank or fake picture, not a receipt);
// null (fixtures, older readings) counts as readable.
public record ReceiptReading(
    string? Store, string? Date, decimal? Subtotal, decimal? Tax, decimal? Total,
    List<ReceiptReadingLine> Lines, bool? Readable = null);

public record ReceiptReadingLine(
    string Text, string? Code, string? Name, decimal? Quantity, string? Unit,
    decimal? UnitPrice, decimal Amount, decimal? Discount, string? Kind, string? Category = null);

public record ReceiptStatusDto(bool Configured, bool Enabled);

// A candidate item for a line. Source: "alias" (learned from an earlier receipt — trusted),
// "suggested" (picked by the model from close names), or "similar" (a close name, unconfirmed).
public record ReceiptCandidateDto(Guid ItemId, string ItemName, Guid? CategoryId, double Score);

public record ReceiptMatchDto(Guid ItemId, string ItemName, Guid? CategoryId, string Source);

public record ReceiptLineDto(
    Guid Id, string Text, string? Code, string? Name, decimal Quantity, string Unit,
    decimal? UnitPrice, decimal Amount, decimal Discount, string Kind,
    ReceiptMatchDto? Match, List<ReceiptCandidateDto> Candidates,
    // The household category the reader put the product in (for a new item), if it chose one.
    Guid? CategoryId = null);

// LinesTotal adds up the lines (items, tax and fees); Difference = Total - LinesTotal (0 when the
// total isn't printed). StoreName is the household store it was matched to (or as printed).
public record ReceiptDraftDto(
    Guid Id, string Status, string? StoreRead, string? StoreName, string? Date,
    decimal? Subtotal, decimal Tax, decimal? Total, decimal LinesTotal, decimal Difference, bool TotalsMatch,
    List<ReceiptLineDto> Lines);

// Applying: which item each kept item line is (new names create items), so the aliases are learned.
public record ApplyReceiptLine(Guid LineId, string ItemName, Guid? CategoryId);
public record ApplyReceiptRequest(string StoreName, List<ApplyReceiptLine> Lines);
public record AppliedReceiptLineDto(Guid LineId, Guid ItemId, string ItemName);
public record ApplyReceiptResultDto(int AliasesLearned, List<AppliedReceiptLineDto> Lines);

// Code is the printed item number when the name is keyed by one (else null).
public record ItemAliasDto(Guid Id, string StoreName, string Label, string? Code, Guid ItemId, string ItemName, int TimesUsed, string LastUsed);

// Adding or correcting a receipt name: the store, the text as printed, the item code if there is one,
// and (when correcting) the item it should mean. Code wins over the text when both are given.
public record SaveItemAliasRequest(string StoreName, string Label, string? Code = null, Guid? ItemId = null);

public record ReceiptTextRequest(string Text);
