using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GroceryTracker.Core.Migrations
{
    /// <inheritdoc />
    public partial class MakeMarketFreshTheDefaultTheme : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // "Market Fresh" is the new look. Profiles still on the old default
            // ("nocturne") move to it; anyone can switch back in Settings. Runs
            // before the column change, which SQLite applies by rebuilding the table.
            migrationBuilder.Sql("""UPDATE "Profiles" SET "Theme" = 'fresh' WHERE "Theme" = 'nocturne';""");

            migrationBuilder.AlterColumn<string>(
                name: "Theme",
                table: "Profiles",
                type: "TEXT",
                maxLength: 32,
                nullable: false,
                defaultValue: "fresh",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldMaxLength: 32,
                oldDefaultValue: "nocturne");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Theme",
                table: "Profiles",
                type: "TEXT",
                maxLength: 32,
                nullable: false,
                defaultValue: "nocturne",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldMaxLength: 32,
                oldDefaultValue: "fresh");
        }
    }
}
