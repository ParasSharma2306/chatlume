/** Returns records belonging to one format, without modifying the source list. */
export function importsOfKind(records, kind) {
    return records.filter((record) => record?.kind === kind);
}
