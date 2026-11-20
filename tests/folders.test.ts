import { describe, expect, it } from 'vitest'
import { migrate, openDatabase } from '../src/main/db'
import { coreMigrations } from '../src/main/db/migrations'
import { addLibrary, listFolders } from '../src/main/library'
import { scanLibrary } from '../src/main/scanner/scan'
import { makeTree, tempDir } from './helpers'

describe('listFolders', () => {
  it('lists folders in natural order with counts that include subfolders', async () => {
    const root = tempDir()
    makeTree(root, {
      'top.jpg': 'x',
      '2019/Italy/a.jpg': 'a',
      '2019/Italy/b.jpg': 'b',
      '2019/France/c.jpg': 'c',
      'Trip 10/d.jpg': 'd',
      'Trip 9/e.jpg': 'e'
    })
    const db = openDatabase(':memory:')
    migrate(db, coreMigrations)
    const lib = addLibrary(db, root)
    await scanLibrary(db, lib)
    db.prepare("UPDATE photos SET status = 'like' WHERE rel_path = '2019/Italy/a.jpg'").run()
    db.prepare("UPDATE photos SET missing = 1 WHERE rel_path = 'Trip 10/d.jpg'").run()

    expect(listFolders(db, lib.id)).toEqual([
      { dirPath: '2019', total: 3, unreviewed: 2 }, // only contains subfolders, still listed
      { dirPath: '2019/France', total: 1, unreviewed: 1 },
      { dirPath: '2019/Italy', total: 2, unreviewed: 1 },
      { dirPath: 'Trip 9', total: 1, unreviewed: 1 } // Trip 10's only photo is missing
    ])
  })
})
