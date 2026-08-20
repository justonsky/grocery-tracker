using ClosedXML.Excel;
using GroceryTracker.Core.Data;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

// Generates the full on-device data backup server-side, from the same rows the
// app persists — guarantees the export is byte-for-byte consistent with what's
// actually stored, and keeps an XLSX-writing library out of the browser bundle.
public class ExportService(GroceryTrackerDbContext db)
{
    public async Task<byte[]> BuildBackupAsync(CancellationToken ct = default)
    {
        var profiles = await db.Profiles
            .Select(p => new { p.Name, p.CreatedAt })
            .ToListAsync(ct);

        // One row per item line. Lists and trips are the same record now, so a single
        // sheet covers both planned and bought items — PickedUp/Price tell them apart.
        var tripItems = await db.TripItems
            .OrderBy(ti => ti.Trip!.Date)
            .Select(ti => new
            {
                Profile = ti.Trip!.Profile!.Name,
                Trip = ti.Trip!.Name,
                ti.Trip!.Date,
                TripStores = ti.Trip!.Stores.OrderBy(s => s.SortOrder).Select(s => s.Name).ToList(),
                BudgetCents = ti.Trip!.BudgetCents,
                Item = ti.Item!.Name,
                Category = ti.Category!.Name,
                Store = ti.Store != null ? ti.Store.Name : null,
                ti.Checked,
                ti.PriceCents,
            })
            .ToListAsync(ct);

        using var workbook = new XLWorkbook();

        var profilesSheet = workbook.Worksheets.Add("Profiles");
        WriteHeader(profilesSheet, "Name", "Created");
        var row = 2;
        foreach (var p in profiles)
        {
            profilesSheet.Cell(row, 1).Value = p.Name;
            profilesSheet.Cell(row, 2).Value = p.CreatedAt.ToString("yyyy-MM-dd");
            row++;
        }

        var tripsSheet = workbook.Worksheets.Add("Trips");
        WriteHeader(tripsSheet, "Profile", "Date", "Trip", "Trip Stores", "Budget",
            "Item", "Category", "Store", "Picked Up", "Price");
        row = 2;
        foreach (var t in tripItems)
        {
            tripsSheet.Cell(row, 1).Value = t.Profile;
            tripsSheet.Cell(row, 2).Value = t.Date;
            tripsSheet.Cell(row, 3).Value = t.Trip ?? "";
            tripsSheet.Cell(row, 4).Value = string.Join(", ", t.TripStores);
            if (t.BudgetCents is { } budget) tripsSheet.Cell(row, 5).Value = budget / 100m;
            tripsSheet.Cell(row, 6).Value = t.Item;
            tripsSheet.Cell(row, 7).Value = t.Category;
            tripsSheet.Cell(row, 8).Value = t.Store ?? "";
            tripsSheet.Cell(row, 9).Value = t.Checked;
            // Left blank rather than 0.00 for an item that has not been bought yet.
            if (t.PriceCents is { } price) tripsSheet.Cell(row, 10).Value = price / 100m;
            row++;
        }

        foreach (var sheet in workbook.Worksheets)
        {
            sheet.Row(1).Style.Font.Bold = true;
            sheet.Columns().AdjustToContents();
        }

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    private static void WriteHeader(IXLWorksheet sheet, params string[] headers)
    {
        for (var i = 0; i < headers.Length; i++)
        {
            sheet.Cell(1, i + 1).Value = headers[i];
        }
    }
}
