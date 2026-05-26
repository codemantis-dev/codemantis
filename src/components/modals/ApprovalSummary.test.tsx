import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ApprovalSummary from "./ApprovalSummary";

describe("ApprovalSummary", () => {
  describe("Bash", () => {
    it("renders Codex Bash with command, cwd, and reason", () => {
      render(
        <ApprovalSummary
          toolName="Bash"
          toolInput={{ command: "ls -la", cwd: "/tmp", reason: "list" }}
        />,
      );
      expect(screen.getByText(/\$ ls -la/)).toBeInTheDocument();
      expect(screen.getByText(/cwd:/)).toBeInTheDocument();
      expect(screen.getByText(/\/tmp/)).toBeInTheDocument();
      expect(screen.getByText(/list/)).toBeInTheDocument();
    });

    it("renders Claude Bash with description fallback for reason", () => {
      render(
        <ApprovalSummary
          toolName="Bash"
          toolInput={{ command: "pwd", description: "Print working dir" }}
        />,
      );
      expect(screen.getByText(/\$ pwd/)).toBeInTheDocument();
      expect(screen.getByText(/Print working dir/)).toBeInTheDocument();
    });

    it("shows placeholder when command missing", () => {
      render(<ApprovalSummary toolName="Bash" toolInput={{}} />);
      expect(screen.getByText(/No command supplied/)).toBeInTheDocument();
    });
  });

  describe("Edit (Codex fileChange)", () => {
    it("renders file path and colorized diff", () => {
      render(
        <ApprovalSummary
          toolName="Edit"
          toolInput={{
            path: "/src/main.rs",
            diff: "+ added line\n- removed line\n@@ -1,2 +1,2 @@",
          }}
        />,
      );
      expect(screen.getByText(/\/src\/main\.rs/)).toBeInTheDocument();
      expect(screen.getByText(/\+ added line/)).toBeInTheDocument();
      expect(screen.getByText(/- removed line/)).toBeInTheDocument();
    });

    it("truncates long diffs and shows hidden count", () => {
      const longDiff = Array.from({ length: 20 }, (_, i) => `+ line${i}`).join("\n");
      render(
        <ApprovalSummary
          toolName="Edit"
          toolInput={{ path: "/x.rs", diff: longDiff }}
        />,
      );
      expect(screen.getByText(/8 more lines/)).toBeInTheDocument();
    });
  });

  describe("Edit (Codex applyPatchApproval)", () => {
    it("renders file-changes list with action types", () => {
      render(
        <ApprovalSummary
          toolName="Edit"
          toolInput={{
            fileChanges: {
              "/a.rs": { type: "add" },
              "/b.rs": { type: "modify" },
              "/c.rs": { type: "delete" },
            },
            reason: "refactor",
          }}
        />,
      );
      expect(screen.getByText(/3 files to change/)).toBeInTheDocument();
      expect(screen.getByText("add")).toBeInTheDocument();
      expect(screen.getByText("modify")).toBeInTheDocument();
      expect(screen.getByText("delete")).toBeInTheDocument();
      expect(screen.getByText(/\/a\.rs/)).toBeInTheDocument();
      expect(screen.getByText(/refactor/)).toBeInTheDocument();
    });

    it("singularizes pluralization for a single file", () => {
      render(
        <ApprovalSummary
          toolName="Edit"
          toolInput={{ fileChanges: { "/x.rs": { type: "add" } } }}
        />,
      );
      expect(screen.getByText(/1 file to change/)).toBeInTheDocument();
    });
  });

  describe("Edit (Claude)", () => {
    it("renders file path and before/after panes", () => {
      render(
        <ApprovalSummary
          toolName="Edit"
          toolInput={{
            file_path: "/src/app.ts",
            old_string: "foo",
            new_string: "bar",
          }}
        />,
      );
      expect(screen.getByText(/\/src\/app\.ts/)).toBeInTheDocument();
      expect(screen.getByText("before")).toBeInTheDocument();
      expect(screen.getByText("after")).toBeInTheDocument();
      expect(screen.getByText("foo")).toBeInTheDocument();
      expect(screen.getByText("bar")).toBeInTheDocument();
    });
  });

  describe("Write (Claude)", () => {
    it("renders file path, size, and content preview", () => {
      render(
        <ApprovalSummary
          toolName="Write"
          toolInput={{
            file_path: "/new.txt",
            content: "hello world",
          }}
        />,
      );
      expect(screen.getByText(/\/new\.txt/)).toBeInTheDocument();
      expect(screen.getByText(/11 chars/)).toBeInTheDocument();
      expect(screen.getByText(/hello world/)).toBeInTheDocument();
    });
  });

  describe("Read (Claude)", () => {
    it("renders file path and line range", () => {
      render(
        <ApprovalSummary
          toolName="Read"
          toolInput={{ file_path: "/data.json", offset: 10, limit: 50 }}
        />,
      );
      expect(screen.getByText(/\/data\.json/)).toBeInTheDocument();
      expect(screen.getByText(/lines 10–59/)).toBeInTheDocument();
    });

    it("renders without range when not provided", () => {
      render(
        <ApprovalSummary
          toolName="Read"
          toolInput={{ file_path: "/data.json" }}
        />,
      );
      expect(screen.getByText(/\/data\.json/)).toBeInTheDocument();
      expect(screen.queryByText(/range:/)).not.toBeInTheDocument();
    });
  });

  describe("PermissionRequest", () => {
    it("renders permission entries as bullets", () => {
      render(
        <ApprovalSummary
          toolName="PermissionRequest"
          toolInput={{ permissions: { network: true, read_files: ["/tmp/**"] } }}
        />,
      );
      expect(
        screen.getByText(/Codex requests these permissions/),
      ).toBeInTheDocument();
      expect(screen.getByText("network:")).toBeInTheDocument();
      expect(screen.getByText("read_files:")).toBeInTheDocument();
    });

    it("renders empty-permissions placeholder", () => {
      render(
        <ApprovalSummary
          toolName="PermissionRequest"
          toolInput={{ permissions: {} }}
        />,
      );
      expect(screen.getByText(/No permissions listed/)).toBeInTheDocument();
    });
  });

  describe("mcp__server__elicitation", () => {
    it("extracts server name and lists schema properties", () => {
      render(
        <ApprovalSummary
          toolName="mcp__context7__elicitation"
          toolInput={{
            mode: "form",
            schema: {
              required: ["library"],
              properties: { library: {}, version: {} },
            },
          }}
        />,
      );
      expect(screen.getByText(/context7/)).toBeInTheDocument();
      expect(screen.getByText("mode:")).toBeInTheDocument();
      expect(screen.getByText("form")).toBeInTheDocument();
      // Required field gets an asterisk
      expect(screen.getByText(/library \*/)).toBeInTheDocument();
      expect(screen.getByText(/version/)).toBeInTheDocument();
    });
  });

  describe("fallback", () => {
    it("renders JSON for unknown tool", () => {
      render(
        <ApprovalSummary
          toolName="CustomMystery"
          toolInput={{ foo: "bar", n: 42 }}
        />,
      );
      // JSON.stringify output should be present somewhere in the rendered text
      expect(screen.getByText(/"foo": "bar"/)).toBeInTheDocument();
      expect(screen.getByText(/"n": 42/)).toBeInTheDocument();
    });

    it("renders empty object when toolInput is null", () => {
      render(<ApprovalSummary toolName="Whatever" toolInput={null} />);
      expect(screen.getByText("{}")).toBeInTheDocument();
    });

    it("renders empty object when toolInput is undefined", () => {
      render(<ApprovalSummary toolName="Whatever" toolInput={undefined} />);
      expect(screen.getByText("{}")).toBeInTheDocument();
    });
  });
});
