# derived from https://github.com/phiresky/world-development-indicators-sqlite/blob/HEAD/create_db.py

set -eu

indb="$1"
outdir="$2"

# for chunked mode, we need to know the database size in bytes beforehand
bytes="$(gstat --printf="%s" "$indb")"
# bytes="$(stat -f%z "$indb")"
# set chunk size to 10MiB (needs to be a multiple of the `pragma page_size`!)
# smaller chunks = smaller git diffs
serverChunkSize=$((1024 * 1024))
suffixLength=3
mkdir -p "$outdir"
rm -f "$outdir/db.sqlite3"*
gsplit "$indb" --bytes=$serverChunkSize "$outdir/db.sqlite3." --suffix-length=$suffixLength --numeric-suffixes

# set request chunk size to match page size
requestChunkSize="$(sqlite3 "$indb" 'pragma page_size')"

# write a json config

# yes, there's easier ways to get a nonce, but this works
cacheBust="$(node -p 'Math.floor(Math.random() * 1e15).toString(36)')"
echo '
{
    "serverMode": "chunked",
    "requestChunkSize": '$requestChunkSize',
    "databaseLengthBytes": '$bytes',
    "serverChunkSize": '$serverChunkSize',
    "urlPrefix": "db.sqlite3.",
    "suffixLength": '$suffixLength',
    "cacheBust": "'$cacheBust'"
}
' > "$outdir/config.json"
