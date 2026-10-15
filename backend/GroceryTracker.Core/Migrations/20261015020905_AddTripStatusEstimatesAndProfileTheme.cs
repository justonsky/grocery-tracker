using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GroceryTracker.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddTripStatusEstimatesAndProfileTheme : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CompletedAt",
                table: "Trips",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "Trips",
                type: "TEXT",
                maxLength: 16,
                nullable: false,
                defaultValue: "Planned");

            migrationBuilder.AddColumn<int>(
                name: "EstimateCents",
                table: "TripItems",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PricedAt",
                table: "TripItems",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Theme",
                table: "Profiles",
                type: "TEXT",
                maxLength: 32,
                nullable: false,
                defaultValue: "nocturne");

            // Existing prices were recorded on their trip's date, not today, so the
            // edit window runs from then: anything older than a week starts locked.
            // Same text format EF Core's SQLite provider writes for DateTimeOffset.
            migrationBuilder.Sql("""
                UPDATE "TripItems"
                SET "PricedAt" = (SELECT t."Date" || ' 12:00:00+00:00' FROM "Trips" t WHERE t."Id" = "TripItems"."TripId")
                WHERE "PriceCents" IS NOT NULL;
                """);

            // Status for existing trips, read off their lines: nothing settled is a
            // plan, everything settled (picked up or priced) is done, else in progress.
            migrationBuilder.Sql("""
                UPDATE "Trips"
                SET "Status" = CASE
                    WHEN NOT EXISTS (SELECT 1 FROM "TripItems" i WHERE i."TripId" = "Trips"."Id"
                                     AND (i."Checked" = 1 OR i."PriceCents" IS NOT NULL)) THEN 'Planned'
                    WHEN NOT EXISTS (SELECT 1 FROM "TripItems" i WHERE i."TripId" = "Trips"."Id"
                                     AND i."Checked" = 0 AND i."PriceCents" IS NULL) THEN 'Done'
                    ELSE 'Shopping'
                END;
                """);
            migrationBuilder.Sql("""
                UPDATE "Trips" SET "CompletedAt" = "Date" || ' 12:00:00+00:00' WHERE "Status" = 'Done';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CompletedAt",
                table: "Trips");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "Trips");

            migrationBuilder.DropColumn(
                name: "EstimateCents",
                table: "TripItems");

            migrationBuilder.DropColumn(
                name: "PricedAt",
                table: "TripItems");

            migrationBuilder.DropColumn(
                name: "Theme",
                table: "Profiles");
        }
    }
}
