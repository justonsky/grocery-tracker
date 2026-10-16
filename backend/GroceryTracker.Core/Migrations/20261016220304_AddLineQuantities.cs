using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GroceryTracker.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddLineQuantities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "QuantityMilli",
                table: "TripItems",
                type: "INTEGER",
                nullable: false,
                defaultValue: 1000);

            migrationBuilder.AddColumn<string>(
                name: "Unit",
                table: "TripItems",
                type: "TEXT",
                maxLength: 8,
                nullable: false,
                defaultValue: "each");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "QuantityMilli",
                table: "TripItems");

            migrationBuilder.DropColumn(
                name: "Unit",
                table: "TripItems");
        }
    }
}
