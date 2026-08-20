using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GroceryTracker.Core.Migrations
{
    /// <inheritdoc />
    public partial class BackfillTripsFromLists : Migration
    {
        // Data-only migration. Grocery lists and trips were always the same record at
        // two points in time, so every list becomes a trip whose items are unpriced
        // (planned, not bought) and every existing trip's single store becomes a
        // one-entry store list.
        //
        // This is deliberately separate from the schema changes either side of it:
        // EF defers SQLite table rebuilds to the end of a migration, so raw SQL sharing
        // a migration with an AlterColumn/DropColumn would run against the pre-rebuild
        // table. Splitting guarantees the rebuilds are already committed.
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Everything already logged as a trip was bought, so it is checked off and
            // inherits the trip's single store.
            migrationBuilder.Sql("""
                UPDATE "TripItems"
                SET "StoreId" = (SELECT t."StoreId" FROM "Trips" t WHERE t."Id" = "TripItems"."TripId"),
                    "Checked" = 1;
                """);

            // Ids are generated here because SQLite has no uuid() — this is the standard
            // randomblob recipe, formatted the way EF stores a Guid.
            const string newGuid = """
                lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
                || substr(lower(hex(randomblob(2))), 2) || '-'
                || substr('89ab', abs(random()) % 4 + 1, 1)
                || substr(lower(hex(randomblob(2))), 2) || '-'
                || lower(hex(randomblob(6)))
                """;

            migrationBuilder.Sql($"""
                INSERT INTO "TripStores" ("Id", "TripId", "Name", "SortOrder")
                SELECT {newGuid}, t."Id", s."Name", 0
                FROM "Trips" t JOIN "Stores" s ON s."Id" = t."StoreId";
                """);

            // Lists keep their ids as trips, so anything that referenced one still resolves.
            // A list's date was optional; a trip's is not.
            migrationBuilder.Sql("""
                INSERT INTO "Trips" ("Id", "ProfileId", "Name", "Date", "BudgetCents", "StoreId", "CreatedAt")
                SELECT "Id", "ProfileId", "Name",
                       COALESCE("Date", strftime('%Y-%m-%d', 'now')),
                       "BudgetCents", NULL, "CreatedAt"
                FROM "GroceryLists";
                """);

            migrationBuilder.Sql("""
                INSERT INTO "TripStores" ("Id", "TripId", "Name", "SortOrder")
                SELECT "Id", "ListId", "Name", "SortOrder" FROM "ListStores";
                """);

            // PriceCents stays null: a list item was never a purchase.
            migrationBuilder.Sql("""
                INSERT INTO "TripItems" ("Id", "TripId", "ItemId", "CategoryId", "StoreId", "Checked", "PriceCents", "SortOrder")
                SELECT "Id", "ListId", "ItemId", "CategoryId", "PreferredStoreId", "Checked", NULL, "SortOrder"
                FROM "ListItems";
                """);
        }

        // Sends the converted lists back to the list tables and forgets the per-item
        // store/checked state that trips did not previously carry.
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                INSERT INTO "GroceryLists" ("Id", "ProfileId", "Name", "Date", "BudgetCents", "CreatedAt")
                SELECT t."Id", t."ProfileId", COALESCE(t."Name", t."Date"), t."Date", t."BudgetCents", t."CreatedAt"
                FROM "Trips" t
                WHERE t."StoreId" IS NULL;
                """);
            migrationBuilder.Sql("""
                INSERT INTO "ListStores" ("Id", "ListId", "Name", "SortOrder")
                SELECT ts."Id", ts."TripId", ts."Name", ts."SortOrder"
                FROM "TripStores" ts
                WHERE ts."TripId" IN (SELECT "Id" FROM "GroceryLists");
                """);
            migrationBuilder.Sql("""
                INSERT INTO "ListItems" ("Id", "ListId", "ItemId", "CategoryId", "PreferredStoreId", "Checked", "SortOrder")
                SELECT ti."Id", ti."TripId", ti."ItemId", ti."CategoryId", ti."StoreId", ti."Checked", ti."SortOrder"
                FROM "TripItems" ti
                WHERE ti."TripId" IN (SELECT "Id" FROM "GroceryLists");
                """);
            migrationBuilder.Sql("""DELETE FROM "TripItems" WHERE "TripId" IN (SELECT "Id" FROM "GroceryLists");""");
            migrationBuilder.Sql("""DELETE FROM "TripStores";""");
            migrationBuilder.Sql("""DELETE FROM "Trips" WHERE "Id" IN (SELECT "Id" FROM "GroceryLists");""");
        }
    }
}
