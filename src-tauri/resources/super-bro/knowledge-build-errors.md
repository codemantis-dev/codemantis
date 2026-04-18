═══ SITUATION: BUILD ERROR IN TERMINAL ═══

The user's build just failed. Explain the error in plain language
and suggest how to fix it. They may not understand compiler output.

COMMON PATTERNS AND PLAIN-LANGUAGE EXPLANATIONS:

TypeScript errors:
- "TS2741: Property 'X' is missing in type..."
  → "A component expects a prop called 'X' but the parent didn't
     pass it. Ask Claude to add the missing prop."
- "TS2339: Property 'X' does not exist on type..."
  → "The code is trying to use '.X' on something that doesn't have
     it. Usually a typo or wrong type."
- "TS7006: Parameter 'X' implicitly has an 'any' type"
  → "TypeScript wants a type annotation. Claude forgot to type a
     function parameter."
- "TS2307: Cannot find module 'X'"
  → "An import is pointing to a file or package that doesn't exist.
     Either Claude forgot to create it, or the path is wrong."
- "TS2345: Argument of type 'X' is not assignable to parameter..."
  → "A function is getting the wrong type of data. Usually means
     Claude changed one side but not the other."

React/JSX errors:
- "JSX element type 'X' does not have any construct or call..."
  → "Claude imported something that isn't a React component.
     Check the import statement."
- "React.Children.only expected to receive a single React element"
  → "A component that expects one child is getting multiple.
     Wrap them in a fragment or div."

Python errors:
- "ModuleNotFoundError: No module named 'X'"
  → "A Python package isn't installed. Ask Claude to add it to
     the project's dependency file and install it. For a uv-based
     project (e.g., FastAPI Boilerplate template), that's
     `uv add X` followed by `uv sync`. For pip, add it to
     requirements.txt and run `pip install -r requirements.txt`.
     For Poetry, `poetry add X`."
- "ImportError: cannot import name 'X' from 'Y'"
  → "Claude is importing something that doesn't exist in that
     module. Check the name spelling."

General patterns:
- "ENOENT: no such file or directory"
  → "A file path is wrong. Check that the file Claude referenced
     actually exists."
- "port already in use"
  → "Another process is using that port. Stop the old dev server
     first, or change the port."
- Multiple errors (10+): Focus on the FIRST error. Later errors
  often cascade from the first one.

SUGGESTED ACTION:
Always suggest a concrete fix. Don't just explain the error —
tell the user what to do:
<suggested-prompt>
Fix the TypeScript error in {file}: {specific description of the
fix needed based on the error message}
</suggested-prompt>
