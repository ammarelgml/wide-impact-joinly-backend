/**
 * Seeds the reviewer demo data (spec: Deployment and delivery > Seed data).
 * Idempotent: re-running resets the demo accounts' data to the same state.
 *
 *   demo teacher  -> "Grade 8 Science" (open, 3 students incl. demo student)
 *                    "Grade 9 Mathematics" (joining closed)
 *   demo student  -> enrolled in "Grade 8 Science"
 *   other teacher -> "Arabic Literature", fixed code 246810 valid 30 days,
 *                    for testing the join-by-code and QR flows as the demo student.
 */
import { pathToFileURL } from 'node:url';
import { type Config, loadConfig } from '../src/config/config.js';
import { type Database, createDatabase } from '../src/db/database.js';
import { HOUR_MS, DAY_MS, addMs, systemClock } from '../src/lib/clock.js';
import { DEMO_ACCOUNTS } from '../src/modules/auth/auth.service.js';
import { ClassroomService } from '../src/modules/classrooms/classroom.service.js';
import { DEMO_JOIN_CODE } from '../src/modules/classrooms/join-code.js';
import { JoinCodeRepository } from '../src/modules/classrooms/join-code.repository.js';
import { EnrollmentRepository } from '../src/modules/enrollments/enrollment.repository.js';
import type { UserRole } from '../src/db/schema.js';

export { DEMO_JOIN_CODE };

async function upsertUser(
  db: Database,
  googleSub: string,
  email: string,
  name: string,
  role: UserRole,
) {
  return db
    .insertInto('users')
    .values({ google_sub: googleSub, email, name, role, avatar_url: null })
    .onConflict((oc) => oc.column('google_sub').doUpdateSet({ email, name }))
    .returning(['id'])
    .executeTakeFirstOrThrow();
}

export async function seedDemoData(db: Database, config: Config): Promise<void> {
  const teacher = await upsertUser(
    db,
    DEMO_ACCOUNTS.teacher.googleSub,
    DEMO_ACCOUNTS.teacher.email,
    DEMO_ACCOUNTS.teacher.name,
    'teacher',
  );
  const student = await upsertUser(
    db,
    DEMO_ACCOUNTS.student.googleSub,
    DEMO_ACCOUNTS.student.email,
    DEMO_ACCOUNTS.student.name,
    'student',
  );
  const otherTeacher = await upsertUser(
    db,
    'seed:teacher-2',
    'youssef.nabil@joinly.app',
    'Mr. Youssef Nabil',
    'teacher',
  );
  const classmates = await Promise.all(
    [
      ['seed:student-1', 'layla.mostafa@joinly.app', 'Layla Mostafa'],
      ['seed:student-2', 'karim.adel@joinly.app', 'Karim Adel'],
    ].map(([sub, email, name]) => upsertUser(db, sub!, email!, name!, 'student')),
  );

  // Reset: classrooms cascade to codes and enrollments.
  await db
    .deleteFrom('classrooms')
    .where('teacher_id', 'in', [teacher.id, otherTeacher.id])
    .execute();

  const classrooms = new ClassroomService(db, systemClock, {
    joinCodeTtlHours: config.joinCodeTtlHours,
  });
  const enrollments = new EnrollmentRepository(db);
  const now = new Date();

  const science = await classrooms.create(teacher.id, {
    name: 'Grade 8 Science',
    description: 'Forces, energy and the scientific method. Room 204, Sun/Tue/Thu.',
  });
  for (const [i, s] of [student, ...classmates].entries()) {
    await enrollments.insertIfAbsent({
      classroomId: science.id,
      studentId: s.id,
      via: i % 2 === 0 ? 'qr' : 'code',
      at: addMs(now, -(i + 1) * HOUR_MS),
    });
  }

  const maths = await classrooms.create(teacher.id, {
    name: 'Grade 9 Mathematics',
    description: 'Algebra and geometry. Joining is closed: everyone is in.',
  });
  await classrooms.update(teacher.id, maths.id, { joiningOpen: false });

  const arabic = await classrooms.create(otherTeacher.id, {
    name: 'Arabic Literature',
    description: `Demo class for reviewers: join it with code ${DEMO_JOIN_CODE}.`,
  });
  const codes = new JoinCodeRepository(db);
  await codes.revokeLive(arabic.id, now);
  // The generator never issues DEMO_JOIN_CODE, so only the seeded class can hold it.
  const demoCode = await codes.insertIfFree({
    classroomId: arabic.id,
    code: DEMO_JOIN_CODE,
    createdAt: now,
    expiresAt: addMs(now, 30 * DAY_MS),
  });
  if (!demoCode) throw new Error(`Demo join code ${DEMO_JOIN_CODE} is held by another classroom`);
}

/** CLI: `pnpm db:seed`. Refuses production unless SEED_CONFIRM=yes. */
async function main() {
  const config = loadConfig();
  if (config.env === 'production' && process.env.SEED_CONFIRM !== 'yes') {
    throw new Error(
      'Refusing to seed a production database. Set SEED_CONFIRM=yes for a review deployment.',
    );
  }
  const db = createDatabase(config.databaseUrl, { max: 2 });
  try {
    await seedDemoData(db, config);
    console.log(`Seeded demo data. Demo join code: ${DEMO_JOIN_CODE}`); // eslint-disable-line no-console
  } finally {
    await db.destroy();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err); // eslint-disable-line no-console
    process.exitCode = 1;
  });
}
