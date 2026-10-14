import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { slashItems, type SlashItem } from "./commands";
import { SlashList, type SlashListProps } from "./slash-menu";

type Props = SuggestionProps<SlashItem, SlashItem>;

/**
 * Typing "/" in an empty paragraph opens the list of blocks to insert. It only opens at the start of an empty
 * paragraph, so a slash inside a sentence ("AI/ML") is just a slash.
 */
export const SlashCommand = Extension.create({
  name: "slashCommand",
  // Above the other keys, so Enter and the arrows go to the open list first.
  priority: 1100,
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommand"),
        char: "/",
        allowSpaces: false,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== "paragraph") return false;
          const container = $from.node($from.depth - 1).type.name;
          return (container === "doc" || container === "section") && state.doc.textBetween($from.start(), range.from) === "";
        },
        items: ({ editor, query }) => slashItems(editor, query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<unknown, SlashListProps> | null = null;
          let host: HTMLDivElement | null = null;
          let current: Props | null = null;
          let index = 0;

          const draw = () => {
            if (!renderer || !current) return;
            renderer.updateProps({ items: current.items, selected: index, onPick: (item: SlashItem) => current?.command(item), onHover: (i: number) => ((index = i), draw()) });
          };
          const place = () => {
            const rect = current?.clientRect?.();
            if (!host || !rect) return;
            void computePosition({ getBoundingClientRect: () => rect }, host, { placement: "bottom-start", middleware: [offset(6), flip(), shift({ padding: 8 })] }).then(({ x, y }) => {
              if (host) Object.assign(host.style, { left: `${x}px`, top: `${y}px` });
            });
          };

          return {
            onStart: (props) => {
              current = props;
              index = 0;
              renderer = new ReactRenderer<unknown, SlashListProps>(SlashList, { props: { items: props.items, selected: 0, onPick: props.command, onHover: () => {} }, editor: props.editor });
              host = document.createElement("div");
              host.style.cssText = "position:absolute;top:0;left:0;z-index:60";
              host.appendChild(renderer.element);
              document.body.appendChild(host);
              draw();
              place();
            },
            onUpdate: (props) => {
              current = props;
              index = Math.min(index, Math.max(0, props.items.length - 1));
              draw();
              place();
            },
            onKeyDown: ({ event }) => {
              if (!current || current.items.length === 0) return false;
              const count = current.items.length;
              if (event.key === "ArrowDown") index = (index + 1) % count;
              else if (event.key === "ArrowUp") index = (index - 1 + count) % count;
              else if (event.key === "Enter" || event.key === "Tab") {
                current.command(current.items[index]);
                return true;
              } else return false;
              draw();
              return true;
            },
            onExit: () => {
              renderer?.destroy();
              host?.remove();
              renderer = host = current = null;
            },
          };
        },
      }),
    ];
  },
});
