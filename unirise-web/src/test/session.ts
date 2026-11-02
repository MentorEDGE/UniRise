import { SESSION_KEY } from "@/mock/helpers";

/** Signs in as one of the demo users (admin, executive, dean, hod, supervisor, researcher, scholar, viewer, acting, itadmin, guest, platform). */
export const signInAs = (role: string) => sessionStorage.setItem(SESSION_KEY, role);

/** The sample-data API throws synchronously where a server would reject; this makes both look the same to a test. */
export const call = async <T,>(f: () => T | Promise<T>): Promise<T> => f();
