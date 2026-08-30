package com.fancyrsvp.checkin.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory

/**
 * The local database — the backbone of this product (spec §5.1).
 *
 * ── Two rules that are release blockers, not preferences ──
 *
 * 1. `fallbackToDestructiveMigration` is FORBIDDEN (§21.2). It silently deletes
 *    the user's data, and here "the user's data" means check-ins that exist
 *    NOWHERE ELSE. A tablet auto-updating overnight before an event would lose
 *    them permanently, with no error and no record. Its absence below is
 *    deliberate; do not add it to "fix" a migration failure.
 *
 * 2. The database is ENCRYPTED at rest via SQLCipher (§20.3). It holds the
 *    complete guest list of a private event — names, tables, VIP designations,
 *    free-text notes — on a tablet that is routinely hired, left unattended at
 *    an entrance, and physically accessible to strangers for hours.
 *
 * ── Schema versioning ──
 *
 * Schema JSON is exported to app/schemas (see build.gradle.kts) and committed.
 * Every future schema change ships an explicit Migration plus a migration test
 * against the previous released version. If a migration ever fails, the app must
 * NOT wipe — it must fail into a recovery mode that preserves the file for
 * extraction (§21.2).
 */
@Database(
    entities = [
        EventEntity::class,
        PartyEntity::class,
        GuestEntity::class,
        GuestStagingEntity::class,
        CheckInEntity::class,
        SyncQueueEntity::class,
        StaffEntity::class,
        VenueTableEntity::class,
        ConflictEntity::class,
    ],
    version = 4,
    exportSchema = true,
)
abstract class CheckinDatabase : RoomDatabase() {

    abstract fun eventDao(): EventDao
    abstract fun partyDao(): PartyDao
    abstract fun guestDao(): GuestDao
    abstract fun guestStagingDao(): GuestStagingDao
    abstract fun checkInDao(): CheckInDao
    abstract fun syncQueueDao(): SyncQueueDao
    abstract fun staffDao(): StaffDao
    abstract fun venueTableDao(): VenueTableDao
    abstract fun conflictDao(): ConflictDao
    abstract fun bundleDao(): BundleDao

    companion object {
        const val NAME = "fancy_checkin.db"

        /**
         * v1 → v2: the event's photograph (§9.8).
         *
         * Two nullable TEXT columns on `events`. ADD COLUMN is the safest change
         * SQLite offers — no table rebuild, no data movement, and nothing to lose
         * if the process dies mid-statement. Existing rows get NULL, which every
         * reader already treats as "this event has no picture".
         *
         * `coverImagePath` holds a FILE PATH, never image bytes. See EventEntity.
         *
         * Deliberately does not touch check-in or queue tables. A tablet upgrading
         * overnight before an event is holding arrivals that exist nowhere else
         * (§21.2), and a migration that only appends nullable columns cannot
         * endanger them.
         */
        private val MIGRATION_1_2 = object : androidx.room.migration.Migration(1, 2) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                // No `DEFAULT NULL` clause, deliberately. A nullable column added
                // by ALTER TABLE is already NULL for every existing row, so it buys
                // nothing — and it makes SQLite record a default that the entity
                // does not declare, which is a shape Room's schema validation
                // compares. Writing the default only in the migration is a classic
                // way to fail `runMigrationsAndValidate` on a change that is
                // otherwise correct.
                db.execSQL("ALTER TABLE events ADD COLUMN coverImageUrl TEXT")
                db.execSQL("ALTER TABLE events ADD COLUMN coverImagePath TEXT")
            }
        }

        /**
         * The event's IANA timezone, so the tablet can print the start time on
         * the VENUE's clock.
         *
         * `startsAt` has always been stored correctly — epoch millis, a real
         * instant. What was wrong was the rendering: PrepareScreen formatted it
         * with the platform default DateFormat, which uses the DEVICE's zone. A
         * check-in tablet is routinely a rented, borrowed, or freshly-unboxed
         * Android device whose timezone nobody has ever looked at, so staff
         * could be shown a start time hours away from the one on the guests'
         * invitations — at the door, while those guests were arriving.
         *
         * One nullable TEXT column, appended. Same reasoning as MIGRATION_1_2:
         * no table rebuild, nothing to lose if the process dies mid-statement,
         * and no check-in or queue table is touched. A tablet upgrading the
         * night before an event is holding arrivals that exist nowhere else.
         *
         * NULL for every existing row, which readers treat as "unknown" and
         * fall back to the device zone — exactly today's behaviour, so an
         * upgraded tablet that has not re-prepared is no worse off than before.
         */
        private val MIGRATION_2_3 = object : androidx.room.migration.Migration(2, 3) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                // No `DEFAULT NULL` — see the note in MIGRATION_1_2 for why
                // writing one here fails runMigrationsAndValidate.
                db.execSQL("ALTER TABLE events ADD COLUMN timezone TEXT")
            }
        }

        /**
         * The venue layout, so the tablet can DRAW the room rather than name a
         * table (the seating plan on the scan result).
         *
         * Eight columns appended to `venue_tables`. That table has held
         * `id, name, capacity` since v1 and been read by nothing — the plan is
         * the first consumer, and a plan needs coordinates.
         *
         * ── Why every one of them is nullable ──
         *
         * Two reasons, and both are load-bearing:
         *
         *  1. A nullable column added by ALTER TABLE is already NULL for every
         *     existing row, so no DEFAULT clause is needed — and writing one
         *     anyway makes SQLite record a default the entity does not declare,
         *     which is a shape `runMigrationsAndValidate` compares and fails on.
         *     Same reasoning as MIGRATION_1_2; see the note there.
         *  2. NULL is the honest reading of an un-re-prepared tablet: it holds
         *     no geometry, so it draws no plan and shows the table numeral
         *     alone, exactly as it does today. A non-null default of 0 would
         *     stack the whole venue on the canvas origin.
         *
         * Appends only. No table is rebuilt, nothing is moved, and neither
         * `check_ins` nor `sync_queue` is touched — a tablet upgrading the night
         * before an event is holding arrivals that exist nowhere else (§21.2).
         */
        private val MIGRATION_3_4 = object : androidx.room.migration.Migration(3, 4) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                // REAL, not INTEGER: position is a percentage with a fractional
                // part, and rotation is degrees. SQLite would accept the value
                // either way, but Room compares the DECLARED affinity against
                // the entity's Double and fails validation on a mismatch.
                db.execSQL("ALTER TABLE venue_tables ADD COLUMN elementType TEXT")
                db.execSQL("ALTER TABLE venue_tables ADD COLUMN shape TEXT")
                db.execSQL("ALTER TABLE venue_tables ADD COLUMN positionX REAL")
                db.execSQL("ALTER TABLE venue_tables ADD COLUMN positionY REAL")
                db.execSQL("ALTER TABLE venue_tables ADD COLUMN width REAL")
                db.execSQL("ALTER TABLE venue_tables ADD COLUMN height REAL")
                db.execSQL("ALTER TABLE venue_tables ADD COLUMN rotation REAL")
                db.execSQL("ALTER TABLE venue_tables ADD COLUMN color TEXT")
            }
        }

        /**
         * All migrations, in order.
         *
         * When this grows: every entry must have a matching test in
         * androidTest/MigrationTest.kt that runs against the committed schema
         * JSON for the PREVIOUS version. A migration with no test is how a
         * fleet of tablets loses a night's check-ins.
         */
        val MIGRATIONS = arrayOf<androidx.room.migration.Migration>(
            MIGRATION_1_2,
            MIGRATION_2_3,
            MIGRATION_3_4,
        )

        /**
         * Loads SQLCipher's native library. Idempotent — the JVM ignores repeat
         * calls for an already-loaded library.
         *
         * REQUIRED. `net.zetetic:sqlcipher-android` does NOT self-initialise: the
         * older `android-database-sqlcipher` artifact loaded itself via
         * `SQLiteDatabase.loadLibs(context)`, and the rewrite dropped that in
         * favour of an explicit call. Omitting it does not fail at build time or
         * when the database is constructed — Room is lazy, so it fails at the
         * FIRST QUERY, with an UnsatisfiedLinkError.
         *
         * That error is a `java.lang.Error`, not an `Exception`, so it passes
         * straight through every `catch (e: Exception)` in the app and terminates
         * the process. In this app the first query happens inside an OkHttp
         * interceptor during device pairing, which made it look like a pairing or
         * networking fault rather than a missing initialisation.
         */
        private fun loadNativeLibrary() {
            System.loadLibrary("sqlcipher")
        }

        fun build(context: Context, passphrase: ByteArray): CheckinDatabase {
            loadNativeLibrary()

            // SupportOpenHelperFactory zeroes the passphrase array it is given,
            // so the caller must not reuse or retain it afterwards.
            val factory = SupportOpenHelperFactory(passphrase)

            return Room.databaseBuilder(context, CheckinDatabase::class.java, NAME)
                .openHelperFactory(factory)
                .addMigrations(*MIGRATIONS)
                // No fallbackToDestructiveMigration. See the class comment.
                // A missing migration must crash loudly in development rather
                // than delete a venue's arrival record in production.
                .build()
        }
    }
}
