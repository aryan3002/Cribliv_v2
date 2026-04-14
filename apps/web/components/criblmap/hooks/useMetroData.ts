"use client";

import { useEffect, useState, useRef } from "react";
import { fetchApi } from "../../../lib/api";

export interface MetroStation {
  id: number;
  name: string;
  lat: number;
  lng: number;
  sequence: number;
}

export interface MetroLine {
  line_name: string;
  line_color: string;
  stations: MetroStation[];
}

let cachedLines: MetroLine[] | null = null;

export function useMetroData() {
  const [lines, setLines] = useState<MetroLine[]>(cachedLines ?? []);
  const [loading, setLoading] = useState(!cachedLines);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (cachedLines || fetchedRef.current) return;
    fetchedRef.current = true;

    fetchApi<{ lines: MetroLine[] }>("/map/metro?city=delhi")
      .then((data) => {
        cachedLines = data.lines;
        setLines(data.lines);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { lines, loading };
}
