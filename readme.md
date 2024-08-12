to run in watch mode:
```bash
# install air
go install github.com/air-verse/air@latest

# run air
air
```



make sure you have sqlboiler installed:
```bash
go install github.com/volatiletech/sqlboiler/v4@latest

# also install the sqlite3 driver
go install github.com/volatiletech/sqlboiler/drivers/sqlboiler-sqlite3@latest
```

run this to generate models:
```bash
sqlboiler sqlite3 --add-global-variants --add-panic-variants
```
