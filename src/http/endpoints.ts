import { authEndpoints } from '../modules/auth/endpoints.js';
import { classroomsEndpoints } from '../modules/classrooms/endpoints.js';
import { enrollmentsEndpoints } from '../modules/enrollments/endpoints.js';

/** Every endpoint of the API, in documentation order. */
export const allEndpoints = { ...authEndpoints, ...classroomsEndpoints, ...enrollmentsEndpoints };
