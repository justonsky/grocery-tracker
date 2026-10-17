namespace GroceryTracker.Core.Entities;

public enum ReceiptStatus { Draft, Applied }

// A receipt read by the vision model, waiting to be reviewed and merged into a trip. The
// photo is a file in the data folder (receipts/<id>) only until the receipt is applied or
// discarded; nothing else from the photo is kept (no card digits, no membership numbers).
public class Receipt
{
    public Guid Id { get; set; }
    public ReceiptStatus Status { get; set; }
    // As printed ("ALDI", "BJ's Wholesale Club") — StoreName is the household store it was taken to be.
    public string? StoreRead { get; set; }
    public string? StoreName { get; set; }
    public string? Date { get; set; } // yyyy-MM-dd, when printed
    public int? SubtotalCents { get; set; }
    public int TaxCents { get; set; }
    public int? TotalCents { get; set; }
    public bool HasImage { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? AppliedAt { get; set; }

    public List<ReceiptLine> Lines { get; set; } = [];
}

// One printed line: an item (PriceCents = what it cost after any coupon printed under it),
// or tax / a fee / a tip / a deposit. Quantity and unit as on the receipt ("2 @", "1.55 lb x").
public class ReceiptLine
{
    public Guid Id { get; set; }
    public Guid ReceiptId { get; set; }
    public int SortOrder { get; set; }
    public required string Text { get; set; }
    public string? Code { get; set; }
    public string? Name { get; set; } // a readable product name, the model's best guess
    public int QuantityMilli { get; set; } = 1000;
    public string Unit { get; set; } = "each";
    public int? UnitPriceCents { get; set; }
    public int PriceCents { get; set; }
    public int DiscountCents { get; set; }
    public string Kind { get; set; } = "item"; // item | tax | fee | tip | deposit
    public string? Category { get; set; } // the reader's pick from the household's categories

    public Receipt? Receipt { get; set; }
}

// "At this store, this printed code (or text) is this item" — learned from every receipt line
// the user confirms, so the next receipt from the store matches it without asking.
public class ItemAlias
{
    public Guid Id { get; set; }
    public Guid StoreId { get; set; }
    // "code:343190" or "text:redcd sodium broth" (ReceiptKeys.KeyFor).
    public required string Key { get; set; }
    public required string Label { get; set; } // as printed, for the Items page
    public Guid ItemId { get; set; }
    public int TimesUsed { get; set; }
    public DateTimeOffset LastUsedAt { get; set; }

    public Store? Store { get; set; }
    public Item? Item { get; set; }
}
