using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GroceryTracker.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddTripPlanningFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "StoreId",
                table: "Trips",
                type: "TEXT",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "TEXT");

            migrationBuilder.AddColumn<int>(
                name: "BudgetCents",
                table: "Trips",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Name",
                table: "Trips",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "PriceCents",
                table: "TripItems",
                type: "INTEGER",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "INTEGER");

            migrationBuilder.AddColumn<bool>(
                name: "Checked",
                table: "TripItems",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "StoreId",
                table: "TripItems",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "TripStores",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    TripId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    SortOrder = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TripStores", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TripStores_Trips_TripId",
                        column: x => x.TripId,
                        principalTable: "Trips",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TripItems_StoreId",
                table: "TripItems",
                column: "StoreId");

            migrationBuilder.CreateIndex(
                name: "IX_TripStores_TripId",
                table: "TripStores",
                column: "TripId");

            migrationBuilder.AddForeignKey(
                name: "FK_TripItems_Stores_StoreId",
                table: "TripItems",
                column: "StoreId",
                principalTable: "Stores",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_TripItems_Stores_StoreId",
                table: "TripItems");

            migrationBuilder.DropTable(
                name: "TripStores");

            migrationBuilder.DropIndex(
                name: "IX_TripItems_StoreId",
                table: "TripItems");

            migrationBuilder.DropColumn(
                name: "BudgetCents",
                table: "Trips");

            migrationBuilder.DropColumn(
                name: "Name",
                table: "Trips");

            migrationBuilder.DropColumn(
                name: "Checked",
                table: "TripItems");

            migrationBuilder.DropColumn(
                name: "StoreId",
                table: "TripItems");

            migrationBuilder.AlterColumn<Guid>(
                name: "StoreId",
                table: "Trips",
                type: "TEXT",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "TEXT",
                oldNullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "PriceCents",
                table: "TripItems",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "INTEGER",
                oldNullable: true);
        }
    }
}
