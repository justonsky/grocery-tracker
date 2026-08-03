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

        var trips = await db.TripItems
            .Select(ti => new
            {
                Profile = ti.Trip!.Profile!.Name,
                ti.Trip!.Date,
                Store = ti.Trip!.Store!.Name,
                Item = ti.Item!.Name,
                Category = ti.Category!.Name,
                ti.PriceCents,
            })
            .ToListAsync(ct);

        var listItems = await db.ListItems
            .Select(li => new
            {
                Profile = li.List!.Profile!.Name,
                List = li.List!.Name,
                li.List!.Date,
                Item = li.Item!.Name,
                Category = li.Category!.Name,
                PreferredStore = li.PreferredStore != null ? li.PreferredStore.Name : null,
                li.Checked,
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
        WriteHeader(tripsSheet, "Profile", "Date", "Store", "Item", "Category", "Price");
        row = 2;
        foreach (var t in trips)
        {
            tripsSheet.Cell(row, 1).Value = t.Profile;
            tripsSheet.Cell(row, 2).Value = t.Date;
            tripsSheet.Cell(row, 3).Value = t.Store;
            tripsSheet.Cell(row, 4).Value = t.Item;
            tripsSheet.Cell(row, 5).Value = t.Category;
            tripsSheet.Cell(row, 6).Value = t.PriceCents / 100m;
            row++;
        }

        var listsSheet = workbook.Worksheets.Add("Lists");
        WriteHeader(listsSheet, "Profile", "List", "Planned Date", "Item", "Category", "Preferred Store", "Checked");
        row = 2;
        foreach (var l in listItems)
        {
            listsSheet.Cell(row, 1).Value = l.Profile;
            listsSheet.Cell(row, 2).Value = l.List;
            listsSheet.Cell(row, 3).Value = l.Date ?? "";
            listsSheet.Cell(row, 4).Value = l.Item;
            listsSheet.Cell(row, 5).Value = l.Category;
            listsSheet.Cell(row, 6).Value = l.PreferredStore ?? "";
            listsSheet.Cell(row, 7).Value = l.Checked;
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
