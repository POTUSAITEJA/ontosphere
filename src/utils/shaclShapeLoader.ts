import { rdfManager } from './rdfManager';

const SHACL_GRAPH = 'urn:vg:shapes';
const SHAPE_EXTENSIONS = ['.ttl', '.shacl', '.turtle'];

export interface ShapeLoadEntry {
  name: string;
  url: string;
  shapeCount: number;
}

export interface ShapeLoadError {
  url: string;
  error: string;
}

export interface ShapeLoadManifest {
  loaded: ShapeLoadEntry[];
  errors: ShapeLoadError[];
}

interface GitHubContentItem {
  name: string;
  download_url: string | null;
  type: string;
}

function parseGitHubTreeUrl(url: string): { owner: string; repo: string; branch: string; path: string } | null {
  const match = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/,
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2], branch: match[3], path: match[4] };
}

function isShapeFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SHAPE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

async function fetchGitHubFolderFiles(
  owner: string,
  repo: string,
  path: string,
  branch: string,
): Promise<{ name: string; downloadUrl: string }[]> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const resp = await fetch(apiUrl, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${resp.statusText}`);
  const items: GitHubContentItem[] = await resp.json();
  return items
    .filter(item => item.type === 'file' && item.download_url && isShapeFile(item.name))
    .map(item => ({ name: item.name, downloadUrl: item.download_url! }));
}

async function loadSingleShapeFile(
  url: string,
  name: string,
): Promise<ShapeLoadEntry> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed ${resp.status}: ${resp.statusText}`);
  const turtle = await resp.text();
  await rdfManager.loadRDFIntoGraph(turtle, SHACL_GRAPH, 'text/turtle');
  const SH_NODESHAPE = 'http://www.w3.org/ns/shacl#NodeShape';
  const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  const { items } = await rdfManager.fetchQuadsPage({ graphName: SHACL_GRAPH, limit: 0 });
  const shapeCount = (items ?? []).filter(
    q => q.predicate === RDF_TYPE && q.object === SH_NODESHAPE,
  ).length;
  return { name, url, shapeCount };
}

export async function loadShaclShapes(urlInput: string): Promise<ShapeLoadManifest> {
  const loaded: ShapeLoadEntry[] = [];
  const errors: ShapeLoadError[] = [];

  const urls = urlInput.split(',').map(s => s.trim()).filter(Boolean);

  for (const url of urls) {
    const ghTree = parseGitHubTreeUrl(url);
    if (ghTree) {
      try {
        const files = await fetchGitHubFolderFiles(ghTree.owner, ghTree.repo, ghTree.path, ghTree.branch);
        if (files.length === 0) {
          errors.push({ url, error: 'No .ttl/.shacl files found in folder' });
          continue;
        }
        for (const file of files) {
          try {
            const entry = await loadSingleShapeFile(file.downloadUrl, file.name);
            loaded.push(entry);
          } catch (e) {
            errors.push({ url: file.downloadUrl, error: String(e) });
          }
        }
      } catch (e) {
        errors.push({ url, error: String(e) });
      }
    } else {
      try {
        const name = url.split('/').pop() ?? url;
        const entry = await loadSingleShapeFile(url, name);
        loaded.push(entry);
      } catch (e) {
        errors.push({ url, error: String(e) });
      }
    }
  }

  return { loaded, errors };
}
