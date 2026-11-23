import type { ClassroomPreview, ClassroomSummary, Enrollment } from './schemas.js';
import type { JoinedVia } from '../classrooms/schemas.js';
import type { Page } from '../../http/common.schemas.js';
import type { Database } from '../../db/database.js';
import { isForeignKeyViolation } from '../../db/database.js';
import { AppError, notFound } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import { decodeCursor, toPage } from '../../lib/cursor.js';
import { KeyedMutex } from '../../lib/keyed-mutex.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import { JoinCodeRepository } from '../classrooms/join-code.repository.js';
import {
  EnrollmentRepository,
  type EnrollmentRecord,
  type SummaryRecord,
} from './enrollment.repository.js';

/**
 * Student-side rules. A scanned QR and a typed code both land in resolveCode,
 * so they behave identically, and regenerating a code disables both.
 */
export class EnrollmentService {
  private readonly lookups = new KeyedMutex();

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    /** Failed code lookups per student (D7). Only failures count. */
    private readonly failedAttempts: RateLimiter,
  ) {}

  async preview(studentId: string, code: string): Promise<ClassroomPreview> {
    const classroomId = await this.resolveCode(studentId, code);
    const repo = new EnrollmentRepository(this.db);
    const [summary, existing] = await Promise.all([
      repo.summary(classroomId),
      repo.find(classroomId, studentId),
    ]);
    if (!summary) throw invalidCode();
    return { classroom: toSummaryDto(summary), alreadyMember: existing !== undefined };
  }

  async join(
    studentId: string,
    code: string,
    via: JoinedVia,
  ): Promise<{ enrollment: Enrollment; isNew: boolean }> {
    const classroomId = await this.resolveCode(studentId, code);
    const repo = new EnrollmentRepository(this.db);

    let inserted;
    try {
      inserted = await repo.insertIfAbsent({ classroomId, studentId, via, at: this.clock.now() });
    } catch (err) {
      // Classroom deleted between lookup and insert.
      if (isForeignKeyViolation(err)) throw invalidCode();
      throw err;
    }
    const membership = inserted ?? (await repo.find(classroomId, studentId));
    const summary = await repo.summary(classroomId);
    if (!membership || !summary) throw invalidCode();

    return {
      isNew: inserted !== undefined,
      enrollment: {
        classroom: toSummaryDto(summary),
        joinedAt: membership.joined_at.toISOString(),
        joinedVia: membership.joined_via,
        alreadyMember: inserted === undefined,
      },
    };
  }

  async list(
    studentId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Page<Enrollment>> {
    const rows = await new EnrollmentRepository(this.db).listForStudent(
      studentId,
      decodeCursor(cursor),
      limit,
    );
    return toPage(rows, limit, (r) => ({ t: r.joinedAt, id: r.id }), toEnrollmentDto);
  }

  async leave(studentId: string, classroomId: string): Promise<void> {
    if (!(await new EnrollmentRepository(this.db).delete(classroomId, studentId))) {
      throw notFound('Enrollment');
    }
  }

  /**
   * Maps a code to a joinable classroom id, or throws the precise reason it is not joinable.
   *
   * Lookups are serialised per student so the failed-attempt budget holds under
   * concurrency: otherwise a burst of wrong guesses could all pass check() before
   * any of them is counted by hit().
   */
  private resolveCode(studentId: string, code: string): Promise<string> {
    const key = `join-fail:${studentId}`;
    return this.lookups.run(key, () => this.resolveCodeNow(key, code));
  }

  private async resolveCodeNow(key: string, code: string): Promise<string> {
    const gate = this.failedAttempts.check(key);
    if (!gate.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many invalid codes. Wait and try again.', {
        retryAfterSeconds: gate.retryAfterSeconds,
      });
    }

    const found = await new JoinCodeRepository(this.db).findLatestByCode(code);
    const now = this.clock.now();

    if (!found || found.revokedReason === 'regenerated') {
      this.failedAttempts.hit(key);
      throw invalidCode();
    }
    if (found.revokedReason === 'expired' || found.expiresAt <= now) {
      throw new AppError(
        'JOIN_CODE_EXPIRED',
        'This code has expired. Ask your teacher for a new one.',
      );
    }
    if (!found.joiningOpen) {
      throw new AppError('JOINING_CLOSED', 'The teacher has closed joining for this class.');
    }
    return found.classroomId;
  }
}

const invalidCode = () =>
  new AppError('JOIN_CODE_INVALID', 'No class uses this code. Check it and try again.');

const toSummaryDto = (s: SummaryRecord): ClassroomSummary => ({
  id: s.id,
  name: s.name,
  description: s.description,
  teacher: { name: s.teacherName, avatarUrl: s.teacherAvatarUrl },
  studentCount: s.studentCount,
});

const toEnrollmentDto = (r: EnrollmentRecord): Enrollment => ({
  classroom: toSummaryDto(r),
  joinedAt: r.joinedAt.toISOString(),
  joinedVia: r.joinedVia,
  alreadyMember: true,
});
