import type {
  Classroom,
  CreateClassroomBody,
  JoinCode,
  RosterPage,
  UpdateClassroomBody,
} from './schemas.js';
import type { Page } from '../../http/common.schemas.js';
import type { Database, Executor } from '../../db/database.js';
import { notFound } from '../../lib/app-error.js';
import { type Clock, HOUR_MS, addMs } from '../../lib/clock.js';
import { decodeCursor, toPage } from '../../lib/cursor.js';
import { ClassroomRepository } from './classroom.repository.js';
import { toClassroomDto, toJoinCodeDto, toRosterStudentDto } from './classroom.mapper.js';
import { MAX_CODE_ATTEMPTS, generateJoinCode } from './join-code.js';
import { JoinCodeRepository } from './join-code.repository.js';

export interface ClassroomServiceOptions {
  joinCodeTtlHours: number;
  /** Public origin for https join links; custom-scheme links when absent. */
  publicUrl?: string;
  generateCode?: () => string;
}

/** Teacher-side rules. Every method takes the teacher id and scopes by ownership (404 otherwise, D13). */
export class ClassroomService {
  private readonly generateCode: () => string;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly opts: ClassroomServiceOptions,
  ) {
    this.generateCode = opts.generateCode ?? (() => generateJoinCode());
  }

  async create(teacherId: string, body: CreateClassroomBody): Promise<Classroom> {
    const id = await this.db.transaction().execute(async (trx) => {
      const { id } = await new ClassroomRepository(trx).insert({
        teacherId,
        name: body.name,
        description: emptyToNull(body.description),
      });
      await this.issueCode(trx, id);
      return id;
    });
    return this.get(teacherId, id);
  }

  async get(teacherId: string, id: string): Promise<Classroom> {
    const record = await new ClassroomRepository(this.db).findOwned(id, teacherId);
    if (!record) throw notFound('Classroom');
    return toClassroomDto(record, this.clock.now(), this.opts.publicUrl);
  }

  async list(
    teacherId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Page<Classroom>> {
    const rows = await new ClassroomRepository(this.db).listOwned(
      teacherId,
      decodeCursor(cursor),
      limit,
    );
    const now = this.clock.now();
    return toPage(
      rows,
      limit,
      (r) => ({ t: r.createdAt, id: r.id }),
      (r) => toClassroomDto(r, now, this.opts.publicUrl),
    );
  }

  async update(teacherId: string, id: string, body: UpdateClassroomBody): Promise<Classroom> {
    const updated = await new ClassroomRepository(this.db).update(id, teacherId, {
      ...body,
      ...(body.description !== undefined && { description: emptyToNull(body.description) }),
    });
    if (!updated) throw notFound('Classroom');
    return this.get(teacherId, id);
  }

  async delete(teacherId: string, id: string): Promise<void> {
    if (!(await new ClassroomRepository(this.db).delete(id, teacherId)))
      throw notFound('Classroom');
  }

  async getJoinCode(teacherId: string, id: string): Promise<JoinCode> {
    const classroom = await this.get(teacherId, id);
    if (!classroom.joinCode) throw notFound('Live join code');
    return classroom.joinCode;
  }

  /** Revokes the live code (and so its QR) and issues a new one, atomically. */
  async regenerateJoinCode(teacherId: string, id: string): Promise<JoinCode> {
    return this.db.transaction().execute(async (trx) => {
      if (!(await new ClassroomRepository(trx).lockOwned(id, teacherId)))
        throw notFound('Classroom');
      await new JoinCodeRepository(trx).revokeLive(id, this.clock.now());
      return this.issueCode(trx, id);
    });
  }

  async listStudents(
    teacherId: string,
    id: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<RosterPage> {
    const repo = new ClassroomRepository(this.db);
    if (!(await repo.findOwned(id, teacherId))) throw notFound('Classroom');
    const [rows, total] = await Promise.all([
      repo.roster(id, decodeCursor(cursor), limit),
      repo.rosterTotal(id),
    ]);
    const page = toPage(rows, limit, (r) => ({ t: r.joinedAt, id: r.id }), toRosterStudentDto);
    return { ...page, total };
  }

  async removeStudent(teacherId: string, id: string, studentId: string): Promise<void> {
    const repo = new ClassroomRepository(this.db);
    if (!(await repo.findOwned(id, teacherId))) throw notFound('Classroom');
    if (!(await repo.removeStudent(id, studentId))) throw notFound('Student');
  }

  /**
   * Inserts a new live code for a classroom that has none. Expired codes are
   * swept first to free their numbers; a collision with another live code
   * retries with a fresh number.
   */
  private async issueCode(trx: Executor, classroomId: string): Promise<JoinCode> {
    const codes = new JoinCodeRepository(trx);
    const now = this.clock.now();
    await codes.sweepExpired(now);
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const row = await codes.insertIfFree({
        classroomId,
        code: this.generateCode(),
        createdAt: now,
        expiresAt: addMs(now, this.opts.joinCodeTtlHours * HOUR_MS),
      });
      if (row) return toJoinCodeDto(row, this.opts.publicUrl);
    }
    throw new Error(`Could not allocate a free join code after ${MAX_CODE_ATTEMPTS} attempts`);
  }
}

const emptyToNull = (s: string | null | undefined) => (s ? s : null);
