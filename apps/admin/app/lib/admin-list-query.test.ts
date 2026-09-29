import { describe, expect, test } from "bun:test";
import { ADMIN_LIST_LIMITS, appendAdminListQuery, parseAdminListQuery } from "./admin-list-query";

describe("admin list query state", () => {
  test("clamps unsupported page sizes to the server-safe default", () => {
    const query = parseAdminListQuery(new URL("https://admin.test/users?limit=200&page=0"), "email", "asc");
    expect(ADMIN_LIST_LIMITS).toEqual([10, 25, 50]);
    expect(query.limit).toBe(50);
    expect(query.page).toBe(1);
  });

  test("preserves search, sorting, and pagination as URL state", () => {
    const query = parseAdminListQuery(new URL("https://admin.test/users?q=Somchai&limit=25&page=3&sort=status&direction=asc"), "email");
    const params = new URLSearchParams();
    appendAdminListQuery(params, query);
    expect(params.toString()).toBe("limit=25&page=3&q=Somchai&sort=status&direction=asc");
  });

  test("rejects an unknown direction and uses the route default", () => {
    expect(parseAdminListQuery(new URL("https://admin.test/users?direction=random"), "email", "asc").direction).toBe("asc");
  });
});
