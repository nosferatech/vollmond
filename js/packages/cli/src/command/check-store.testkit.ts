// A store for the tests of the commands that check and read it under its schema.

/**
 * A store with five records: a dangling link in a.md, an `<a id>` that anchors nothing in b.md, a task whose title breaks its
 * schema and whose owner points outside its `targets`, a task whose owner alone does, and a person.
 */
export function checkStoreFiles(): Record<string, string> {
  return {
    ".vmd/config.yaml": 'vmd: 1\ncollections:\n  tasks:\n    match: ["tasks/*.json"]\n    schema: task.schema.json\n',
    ".vmd/schema/task.schema.json": JSON.stringify({
      type: "object",
      properties: {
        title: { type: "string" },
        owner: { type: "string", format: "uri-reference", "x-vmd-ref": { targets: ["people/**"] } },
      },
    }),
    "a.md": '# A\n\n## Intro <a id="intro"></a>\n\nText with [a link](b.md#missing).\n',
    "b.md": '# B\n\nSee [intro](a.md#intro) and a <a id="x"></a> word.\n',
    "people/p.md": "# P\n",
    "tasks/t.json": '{"title": 5, "owner": "../a.md"}\n',
    "tasks/u.json": '{"title": "fine", "owner": "../a.md"}\n',
  };
}
