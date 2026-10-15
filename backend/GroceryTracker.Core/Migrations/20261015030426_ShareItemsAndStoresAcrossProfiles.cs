using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GroceryTracker.Core.Migrations
{
    /// <inheritdoc />
    public partial class ShareItemsAndStoresAcrossProfiles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Before the new unique index on NormalizedName: profiles that each had
            // their own "Milk" collapse onto one row. The oldest row wins (its name
            // and default category), and every trip line pointing at a duplicate is
            // repointed at it, so no purchase history is lost.
            migrationBuilder.Sql("""
                CREATE TEMP TABLE "ItemMerge" AS
                SELECT i."Id" AS "Id",
                       (SELECT k."Id" FROM "Items" k WHERE k."NormalizedName" = i."NormalizedName"
                        ORDER BY k."CreatedAt", k."Id" LIMIT 1) AS "KeepId"
                FROM "Items" i;
                """);
            migrationBuilder.Sql("""
                UPDATE "TripItems"
                SET "ItemId" = (SELECT m."KeepId" FROM "ItemMerge" m WHERE m."Id" = "TripItems"."ItemId")
                WHERE "ItemId" IN (SELECT "Id" FROM "ItemMerge" WHERE "Id" <> "KeepId");
                """);
            migrationBuilder.Sql("""
                DELETE FROM "Items" WHERE "Id" IN (SELECT "Id" FROM "ItemMerge" WHERE "Id" <> "KeepId");
                """);
            migrationBuilder.Sql("""DROP TABLE "ItemMerge";""");

            migrationBuilder.Sql("""
                CREATE TEMP TABLE "StoreMerge" AS
                SELECT s."Id" AS "Id",
                       (SELECT k."Id" FROM "Stores" k WHERE k."NormalizedName" = s."NormalizedName"
                        ORDER BY k."CreatedAt", k."Id" LIMIT 1) AS "KeepId"
                FROM "Stores" s;
                """);
            migrationBuilder.Sql("""
                UPDATE "TripItems"
                SET "StoreId" = (SELECT m."KeepId" FROM "StoreMerge" m WHERE m."Id" = "TripItems"."StoreId")
                WHERE "StoreId" IN (SELECT "Id" FROM "StoreMerge" WHERE "Id" <> "KeepId");
                """);
            migrationBuilder.Sql("""
                DELETE FROM "Stores" WHERE "Id" IN (SELECT "Id" FROM "StoreMerge" WHERE "Id" <> "KeepId");
                """);
            migrationBuilder.Sql("""DROP TABLE "StoreMerge";""");

            migrationBuilder.DropForeignKey(
                name: "FK_Items_Profiles_ProfileId",
                table: "Items");

            migrationBuilder.DropForeignKey(
                name: "FK_Stores_Profiles_ProfileId",
                table: "Stores");

            migrationBuilder.DropIndex(
                name: "IX_Stores_ProfileId_NormalizedName",
                table: "Stores");

            migrationBuilder.DropIndex(
                name: "IX_Items_ProfileId_NormalizedName",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "ProfileId",
                table: "Stores");

            migrationBuilder.DropColumn(
                name: "ProfileId",
                table: "Items");

            migrationBuilder.CreateIndex(
                name: "IX_Stores_NormalizedName",
                table: "Stores",
                column: "NormalizedName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Items_NormalizedName",
                table: "Items",
                column: "NormalizedName",
                unique: true);
        }

        /// <inheritdoc />
        // Restores the columns, not the data: merged items/stores stay merged, and
        // ProfileId comes back empty. Restore the pre-migration .bak to fully undo.
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Stores_NormalizedName",
                table: "Stores");

            migrationBuilder.DropIndex(
                name: "IX_Items_NormalizedName",
                table: "Items");

            migrationBuilder.AddColumn<Guid>(
                name: "ProfileId",
                table: "Stores",
                type: "TEXT",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "ProfileId",
                table: "Items",
                type: "TEXT",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateIndex(
                name: "IX_Stores_ProfileId_NormalizedName",
                table: "Stores",
                columns: new[] { "ProfileId", "NormalizedName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Items_ProfileId_NormalizedName",
                table: "Items",
                columns: new[] { "ProfileId", "NormalizedName" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Items_Profiles_ProfileId",
                table: "Items",
                column: "ProfileId",
                principalTable: "Profiles",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Stores_Profiles_ProfileId",
                table: "Stores",
                column: "ProfileId",
                principalTable: "Profiles",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
