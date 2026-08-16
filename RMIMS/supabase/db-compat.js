// supabase/db-compat.js
//
// A small database compatibility adapter backed by Supabase
// Postgres + Realtime. This exists so the existing RMIMS code
// (analytics.js, dashboard.js, inventory.js, forecasting.js, reports.js,
// settings.js, user-*.js) does not need to be rewritten
// call-by-call. Existing data operations are translated to Supabase
// previous data-access layer to this module; the business logic underneath
// (collection(), doc(), addDoc(), getDocs(), onSnapshot(), query(),
// where(), orderBy(), limit(), writeBatch(), serverTimestamp()) is
// kept compatible while running directly against Supabase
// through this adapter.
//
// This is intentionally scoped to exactly what RMIMS actually uses.
// It is not a general-purpose database abstraction.

// ------------------------------------------------------------------
// case + table-name helpers
// ------------------------------------------------------------------

function camelToSnake(str) {
    return str.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
}

function snakeToCamel(str) {
    return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// Collection path -> Postgres table name.
// "materials" -> "materials", "usageRecords" -> "usage_records", etc.
function tableNameFor(collectionPath) {
    return camelToSnake(collectionPath);
}

const TIMESTAMP_COLUMNS = new Set(["created_at", "updated_at"]);

// Sentinel returned by serverTimestamp(). Fields carrying this value
// are stripped from the outgoing payload — created_at has a DB
// default and updated_at is auto-touched by a trigger (see schema.sql),
// so Postgres fills them in automatically,
// timestamp behavior.
const SERVER_TIMESTAMP = { __rmims_server_timestamp__: true };

export function serverTimestamp() {
    return SERVER_TIMESTAMP;
}

// Converts a JS payload (camelCase, as written throughout RMIMS) into
// a Postgres row (snake_case), dropping serverTimestamp() sentinels.
function toRow(data) {
    const row = {};
    for (const [key, value] of Object.entries(data)) {
        if (value === SERVER_TIMESTAMP) continue;
        row[camelToSnake(key)] = value === undefined ? null : value;
    }
    return row;
}

// Wraps a raw ISO timestamp string from Postgres into a
// timestamp-shaped object so existing helper functions like
// `toMillis(ts)` (which check `typeof ts.toDate === "function"` /
// `typeof ts.seconds === "number"`) keep working unmodified.
function wrapTimestamp(iso) {
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return {
        toDate: () => new Date(ms),
        seconds: Math.floor(ms / 1000),
        toMillis: () => ms
    };
}

// Converts a Postgres row (snake_case) back into the camelCase shape
// the RMIMS UI code expects, wrapping *_at columns as Timestamp-like.
function fromRow(row) {
    const data = {};
    for (const [key, value] of Object.entries(row)) {
        if (key === "id") continue;
        const camelKey = snakeToCamel(key);
        data[camelKey] = TIMESTAMP_COLUMNS.has(key) ? wrapTimestamp(value) : value;
    }
    return data;
}

// ------------------------------------------------------------------
// refs: collection() / doc()
// ------------------------------------------------------------------

export function collection(db, path) {
    return { __type: "collection", db, path, table: tableNameFor(path) };
}

export function doc(dbOrCollectionRef, path, id) {
    // doc(collectionRef) -> new ref with a generated id
    if (dbOrCollectionRef && dbOrCollectionRef.__type === "collection" && path === undefined) {
        return {
            __type: "doc",
            db: dbOrCollectionRef.db,
            path: dbOrCollectionRef.path,
            table: dbOrCollectionRef.table,
            id: crypto.randomUUID()
        };
    }
    // doc(db, "materials", id)
    const table = tableNameFor(path);
    return {
        __type: "doc",
        db: dbOrCollectionRef,
        path,
        table,
        id: id !== undefined ? id : crypto.randomUUID()
    };
}

// ------------------------------------------------------------------
// query building: query() / where() / orderBy() / limit()
// ------------------------------------------------------------------

export function query(ref, ...constraints) {
    return { __type: "query", ref, constraints };
}

export function where(field, op, value) {
    return { __type: "where", field, op, value };
}

export function orderBy(field, direction = "asc") {
    return { __type: "orderBy", field, direction };
}

export function limit(n) {
    return { __type: "limit", n };
}

function resolveTarget(target) {
    // target is either a bare collection ref or a query() wrapper
    if (target.__type === "query") {
        return { collRef: target.ref, constraints: target.constraints };
    }
    return { collRef: target, constraints: [] };
}

function applyConstraints(builder, constraints) {
    for (const c of constraints) {
        if (c.__type === "where") {
            const column = camelToSnake(c.field);
            switch (c.op) {
                case "==":
                    builder = builder.eq(column, c.value);
                    break;
                case "!=":
                    builder = builder.neq(column, c.value);
                    break;
                case "<":
                    builder = builder.lt(column, c.value);
                    break;
                case "<=":
                    builder = builder.lte(column, c.value);
                    break;
                case ">":
                    builder = builder.gt(column, c.value);
                    break;
                case ">=":
                    builder = builder.gte(column, c.value);
                    break;
                case "in":
                    builder = builder.in(column, c.value);
                    break;
                case "array-contains":
                    builder = builder.contains(column, [c.value]);
                    break;
                default:
                    throw new Error(`[db-compat] Unsupported where() operator: ${c.op}`);
            }
        } else if (c.__type === "orderBy") {
            builder = builder.order(camelToSnake(c.field), { ascending: c.direction !== "desc" });
        } else if (c.__type === "limit") {
            builder = builder.limit(c.n);
        }
    }
    return builder;
}

// ------------------------------------------------------------------
// reads: getDoc() / getDocs() / getDocsFromServer()
// ------------------------------------------------------------------

function makeDocSnapshot(id, row) {
    const exists = row !== null && row !== undefined;
    return {
        id,
        exists: () => exists,
        data: () => (exists ? fromRow(row) : undefined)
    };
}

function makeQuerySnapshot(rows) {
    const docs = rows.map((row) => makeDocSnapshot(row.id, row));
    return {
        docs,
        size: docs.length,
        empty: docs.length === 0,
        forEach: (cb) => docs.forEach(cb),
        // docChanges() with no prior state has no way to know "modified" vs
        // "added" outside onSnapshot's diffing — one-shot getDocs() callers
        // in RMIMS never call docChanges(), only onSnapshot() listeners do.
        docChanges: () => docs.map((d) => ({ type: "added", doc: d }))
    };
}

export async function getDoc(docRef) {
    const { data, error } = await docRef.db
        .from(docRef.table)
        .select("*")
        .eq("id", docRef.id)
        .maybeSingle();

    if (error) throw error;
    return makeDocSnapshot(docRef.id, data);
}

export async function getDocs(target) {
    const { collRef, constraints } = resolveTarget(target);
    let builder = collRef.db.from(collRef.table).select("*");
    builder = applyConstraints(builder, constraints);

    const { data, error } = await builder;
    if (error) throw error;
    return makeQuerySnapshot(data || []);
}

// Supabase has no client-side cache layer to bypass — same as getDocs().
export const getDocsFromServer = getDocs;

// ------------------------------------------------------------------
// writes: addDoc() / setDoc() / updateDoc() / deleteDoc()
// ------------------------------------------------------------------

export async function addDoc(collectionRef, data) {
    const row = toRow(data);
    const { data: inserted, error } = await collectionRef.db
        .from(collectionRef.table)
        .insert(row)
        .select("id")
        .single();

    if (error) throw error;
    return { id: inserted.id };
}

export async function setDoc(docRef, data) {
    const row = { id: docRef.id, ...toRow(data) };
    const { error } = await docRef.db.from(docRef.table).upsert(row);
    if (error) throw error;
}

export async function updateDoc(docRef, data) {
    const row = toRow(data);
    const { error } = await docRef.db.from(docRef.table).update(row).eq("id", docRef.id);
    if (error) throw error;
}

export async function deleteDoc(docRef) {
    const { error } = await docRef.db.from(docRef.table).delete().eq("id", docRef.id);
    if (error) throw error;
}

// ------------------------------------------------------------------
// writeBatch() — used by the CSV bulk-import feature in inventory.js
// ------------------------------------------------------------------

export function writeBatch(db) {
    const sets = []; // { table, row }
    const updates = []; // { table, id, row }
    const deletes = []; // { table, id }

    return {
        set(docRef, data) {
            sets.push({ table: docRef.table, row: { id: docRef.id, ...toRow(data) } });
        },
        update(docRef, data) {
            updates.push({ table: docRef.table, id: docRef.id, row: toRow(data) });
        },
        delete(docRef) {
            deletes.push({ table: docRef.table, id: docRef.id });
        },
        async commit() {
            // Group inserts by table for one bulk insert per table (mirrors
            // The operation is executed through Supabase/Postgres.
            const byTable = {};
            for (const s of sets) {
                (byTable[s.table] ||= []).push(s.row);
            }
            for (const [table, rows] of Object.entries(byTable)) {
                const { error } = await db.from(table).insert(rows);
                if (error) throw error;
            }
            for (const u of updates) {
                const { error } = await db.from(u.table).update(u.row).eq("id", u.id);
                if (error) throw error;
            }
            for (const d of deletes) {
                const { error } = await db.from(d.table).delete().eq("id", d.id);
                if (error) throw error;
            }
        }
    };
}

// ------------------------------------------------------------------
// onSnapshot() — realtime listener, used by dashboard.js + inventory.js
// ------------------------------------------------------------------

export function onSnapshot(target, onNext, onError) {
    const { collRef, constraints } = resolveTarget(target);
    let previousIds = new Set();
    let closed = false;

    async function refetchAndEmit() {
        try {
            let builder = collRef.db.from(collRef.table).select("*");
            builder = applyConstraints(builder, constraints);
            const { data, error } = await builder;
            if (error) throw error;

            const rows = data || [];
            const currentIds = new Set(rows.map((r) => r.id));

            const snap = makeQuerySnapshot(rows);
            snap.docChanges = () =>
                rows.map((row) => ({
                    type: previousIds.has(row.id) ? "modified" : "added",
                    doc: makeDocSnapshot(row.id, row)
                }));

            previousIds = currentIds;
            if (!closed) onNext(snap);
        } catch (err) {
            if (onError) onError(err);
        }
    }

    // Initial fetch.
    refetchAndEmit();

    // Live updates via Supabase Realtime (requires the table to be added
    // to the supabase_realtime publication — see schema.sql).
    const channel = collRef.db
        .channel(`compat:${collRef.table}:${Math.random().toString(36).slice(2)}`)
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: collRef.table },
            () => {
                refetchAndEmit();
            }
        )
        .subscribe();

    // Returns an unsubscribe function.
    return () => {
        closed = true;
        collRef.db.removeChannel(channel);
    };
}
