import { defineEndpoints } from '../../http/endpoint.js';
import { PageQuery } from '../../http/common.schemas.js';
import {
  ClassroomPreview,
  Enrollment,
  EnrollmentPage,
  EnrollmentParams,
  JoinBody,
  PreviewBody,
} from './schemas.js';

export const enrollmentsEndpoints = defineEndpoints({
  previewEnrollment: {
    method: 'POST',
    path: '/v1/enrollments/preview',
    tag: 'Enrollments',
    summary: 'Look up a classroom by join code',
    description:
      'Shown to the student before they confirm. Failed lookups count toward the per-student attempt limit. The code travels in the body so it never lands in access logs.',
    access: 'student',
    body: PreviewBody,
    responses: { 200: ClassroomPreview },
    errors: ['JOIN_CODE_INVALID', 'JOIN_CODE_EXPIRED', 'JOINING_CLOSED', 'RATE_LIMITED'],
  },
  joinClassroom: {
    method: 'POST',
    path: '/v1/enrollments',
    tag: 'Enrollments',
    summary: 'Join a classroom',
    description:
      'Idempotent: 201 for a new enrollment, 200 with alreadyMember=true if already enrolled. Safe under concurrent requests.',
    access: 'student',
    body: JoinBody,
    responses: { 201: Enrollment, 200: Enrollment },
    errors: ['JOIN_CODE_INVALID', 'JOIN_CODE_EXPIRED', 'JOINING_CLOSED', 'RATE_LIMITED'],
  },
  listEnrollments: {
    method: 'GET',
    path: '/v1/enrollments',
    tag: 'Enrollments',
    summary: "List the student's classrooms",
    description: 'Most recent joins first, cursor paginated.',
    access: 'student',
    query: PageQuery,
    responses: { 200: EnrollmentPage },
    errors: [],
  },
  leaveClassroom: {
    method: 'DELETE',
    path: '/v1/enrollments/:classroomId',
    tag: 'Enrollments',
    summary: 'Leave a classroom',
    access: 'student',
    params: EnrollmentParams,
    responses: { 204: null },
    errors: ['NOT_FOUND'],
  },
});
