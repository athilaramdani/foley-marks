import { useEffect, useRef, useState } from "react";
import {
  LibraryBig,
  FolderOpen,
  Search,
  FileAudio2,
  Plus,
  Play,
  Pause,
  FolderSync,
  ChevronDown,
  Film,
  Volume2,
  FolderCog,
  FileJson,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Icon } from "./controls";
import { mediaUrl } from "./bridge";
import type { Entry, Dataset } from "./model";
export function Library({
  dataset,
  add,
  select,
  selected,
  importAudio,
  openVideo,
  openProject,
  refresh,
  settings,
  notify,
  label,
}: {
  dataset: Dataset;
  add: (e: Entry) => void;
  select: (e: Entry) => void;
  selected: string;
  importAudio: () => void;
  openVideo: (p: string) => void;
  openProject: (p: string) => void;
  refresh: () => void;
  settings: () => void;
  notify: (s: string) => void;
  label: string;
}) {
  const [tab, setTab] = useState<"sounds" | "videos" | "annotations">("sounds"),
    [filter, setFilter] = useState(""),
    [category, setCategory] = useState(""),
    [limit, setLimit] = useState(120),
    [playing, setPlaying] = useState("");
  const voice = useRef<HTMLAudioElement | null>(null),
    gen = useRef(0);
  useEffect(
    () => () => {
      gen.current++;
      voice.current?.pause();
    },
    [],
  );
  const play = async (e: Entry) => {
    const token = ++gen.current;
    voice.current?.pause();
    setPlaying("");
    if (playing === e.path) return;
    try {
      const url = await mediaUrl(e.path);
      if (token !== gen.current) return;
      const a = new Audio(url);
      voice.current = a;
      a.onended = () => setPlaying("");
      a.onerror = () => {
        setPlaying("");
        notify("Could not play " + e.name);
      };
      await a.play();
      if (token === gen.current) setPlaying(e.path);
    } catch (error) {
      notify(String(error));
    }
  };
  const grouped = dataset[tab],
    categories = [
      ...new Set(grouped.map((e) => e.category).filter(Boolean)),
    ].sort();
  const list = grouped.filter(
    (e) =>
      (!category || e.category === category) &&
      (!filter ||
        (e.name + " " + e.category)
          .toLowerCase()
          .includes(filter.toLowerCase())),
  );
  const choose = (e: Entry) => {
    if (tab === "sounds") {
      select(e);
      add(e);
    } else if (tab === "videos") openVideo(e.path);
    else openProject(e.path);
  };
  return (
    <section className="library panel">
      <div className="panel-heading">
        <div className="panel-name">
          <LibraryBig size={15} />
          {label}
        </div>
        <div className="spacer" />
        <Icon label="Rescan dataset" onClick={refresh}>
          <FolderSync />
        </Icon>
        <Icon label="Dataset settings" onClick={settings}>
          <FolderCog />
        </Icon>
      </div>
      <div className="tabs">
        {(["sounds", "videos", "annotations"] as const).map((key, i) => (
          <button
            key={key}
            className={key === tab ? "on" : ""}
            onClick={() => {
              setTab(key);
              setCategory("");
              setLimit(120);
            }}
          >
            {["Sounds", "Video", "Projects"][i]}
          </button>
        ))}
      </div>
      <div className="library-tools">
        <div className="search">
          <Search size={14} />
          <input
            placeholder={"Search " + tab + "…"}
            aria-label="Search media"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setLimit(120);
            }}
          />
        </div>
        {categories.length > 0 && (
          <div className="category">
            <ChevronDown size={12} />
            <select
              aria-label="Filter category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="asset-count">
        {list.length}{" "}
        {tab === "sounds"
          ? "SOUND EFFECTS"
          : tab === "videos"
            ? "VIDEOS"
            : "PROJECTS"}
      </div>
      <div className="assets">
        {list.length === 0 ? (
          <div className="library-empty">
            <div className="empty-icon">
              <FolderOpen size={24} />
            </div>
            <strong>
              {filter || category
                ? "No matching media"
                : "Your library is empty"}
            </strong>
            <p>
              {filter || category
                ? "Try a different search or category."
                : "Choose a dataset folder to browse local media."}
            </p>
            <Button onClick={settings}>Dataset settings</Button>
          </div>
        ) : (
          list.slice(0, limit).map((e) => (
            <div
              key={e.path}
              className={"asset " + (selected === e.path ? "chosen" : "")}
              role="button"
              tabIndex={0}
              draggable={tab === "sounds"}
              onDragStart={(ev) =>
                ev.dataTransfer.setData(
                  "application/x-foley-sfx",
                  JSON.stringify(e),
                )
              }
              onClick={() => select(e)}
              onDoubleClick={() => choose(e)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") choose(e);
              }}
            >
              <div className="asset-icon">
                {tab === "sounds" ? (
                  <FileAudio2 size={17} />
                ) : tab === "videos" ? (
                  <Film size={17} />
                ) : (
                  <FileJson size={17} />
                )}
              </div>
              <div className="asset-meta">
                <strong title={e.name}>{e.name}</strong>
                <small>
                  {e.category || e.name.split(".").pop()?.toUpperCase()}
                </small>
              </div>
              {tab === "sounds" && (
                <button
                  title="Audition sound"
                  aria-label={"Audition " + e.name}
                  className="audition"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    void play(e);
                  }}
                >
                  {playing === e.path ? (
                    <Pause size={12} />
                  ) : (
                    <Play size={12} />
                  )}
                </button>
              )}
            </div>
          ))
        )}
        {list.length > limit && (
          <Button onClick={() => setLimit(limit + 120)}>Load more</Button>
        )}
      </div>
      <div className="library-footer">
        <Button onClick={importAudio}>
          <Plus size={14} />
          Import sound
        </Button>
        <Volume2 size={14} />
      </div>
    </section>
  );
}
