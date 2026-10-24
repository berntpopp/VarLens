import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { SyntaxKind, type SourceFile } from 'ts-morph'
import { getProject, relPath } from '../../web-gate/helpers/ts-morph-project'

/**
 * Desktop sign-in (#295): the access gate wraps the IPC registration, and
 * tests/main/ipc/ipc-access.test.ts checks at runtime that every channel
 * registered there is gated. This pins that nothing registers past it: only
 * the entry and the IPC index hold the raw ipcMain, the jobs and debug domains
 * only as a default for their own tests, and nothing uses webContents.ipc.
 */

function sourceFile(path: string): SourceFile {
  const file = getProject().getSourceFile(resolve(process.cwd(), path))
  if (!file) throw new Error(`${path} is not part of tsconfig.node.json`)
  return file
}

/** Every use of `name` in `path` outside its import is a parameter's default value. */
function onlyDefaultParameter(path: string, name: string): string[] {
  return sourceFile(path)
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((id) => id.getText() === name && !id.getParent()?.isKind(SyntaxKind.ImportSpecifier))
    .filter((id) => id.getParent()?.asKind(SyntaxKind.Parameter)?.getInitializer() !== id)
    .map((id) => `${path}: ${id.getParentOrThrow().getText()}`)
}

describe('raw ipcMain holders (desktop sign-in)', () => {
  test('only the entry and the IPC index hold the raw ipcMain; no webContents.ipc', () => {
    const holders: string[] = []
    for (const file of getProject().getSourceFiles()) {
      const path = relPath(file.getFilePath())
      if (!path.startsWith('src/main/') || path.endsWith('.test.ts')) continue
      // webContents.ipc is a second way to register handlers past the gate;
      // no module touches an `ipc` property at all.
      for (const access of file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        if (access.getName() === 'ipc') holders.push(`${path} (webContents.ipc)`)
      }
      for (const element of file.getDescendantsOfKind(SyntaxKind.BindingElement)) {
        const name = element.getPropertyNameNode()?.getText() ?? element.getName()
        if (name === 'ipc') holders.push(`${path} (webContents.ipc)`)
        const initializer = element
          .getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
          ?.getInitializer()
        if (name === 'ipcMain' && initializer?.getText().includes("require('electron")) {
          holders.push(`${path} (require)`)
        }
      }
      for (const declaration of file.getExportDeclarations()) {
        const from = declaration.getModuleSpecifierValue() ?? ''
        if (/^electron(\/main)?$/.test(from)) holders.push(`${path} (re-export)`)
      }
      for (const declaration of file.getImportDeclarations()) {
        if (!/^electron(\/main)?$/.test(declaration.getModuleSpecifierValue())) continue
        if (declaration.getNamedImports().some((named) => named.getName() === 'ipcMain')) {
          holders.push(path)
        }
        if (declaration.getNamespaceImport() || declaration.getDefaultImport()) {
          holders.push(`${path} (whole module)`)
        }
      }
      for (const access of file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        if (
          access.getName() === 'ipcMain' &&
          access.getExpression().getText().includes('electron')
        ) {
          holders.push(`${path} (electron.ipcMain)`)
        }
      }
    }
    expect(holders.sort()).toEqual([
      'src/main/index.ts',
      'src/main/ipc/domains/debug.ts',
      'src/main/ipc/domains/jobs.ts',
      'src/main/ipc/index.ts'
    ])
    expect([
      ...onlyDefaultParameter('src/main/ipc/domains/debug.ts', 'electronIpcMain'),
      ...onlyDefaultParameter('src/main/ipc/domains/jobs.ts', 'electronIpcMain')
    ]).toEqual([])

    // The entry keeps one raw listener, a startup milestone without data, and
    // passes ipcMain nowhere else.
    const entryUses = sourceFile('src/main/index.ts')
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .filter(
        (id) => id.getText() === 'ipcMain' && !id.getParent()?.isKind(SyntaxKind.ImportSpecifier)
      )
      .map((id) => {
        const access = id.getParent()?.asKind(SyntaxKind.PropertyAccessExpression)
        const call = access?.getParent()?.asKind(SyntaxKind.CallExpression)
        const statement = call?.getParent()?.isKind(SyntaxKind.ExpressionStatement)
        if (!access || !call || !statement || access.getExpression() !== id) {
          return `other use: ${id.getParentOrThrow().getText()}`
        }
        return `${access.getName()}(${call.getArguments()[0]?.getText()})`
      })
    expect(entryUses).toEqual(["once('perf:interactive')"])

    // src/main/ipc/index.ts hands it straight to createIpcRegistrars.
    const factoryUses = sourceFile('src/main/ipc/index.ts')
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .filter(
        (id) => id.getText() === 'rawIpcMain' && !id.getParent()?.isKind(SyntaxKind.ImportSpecifier)
      )
      .map((id) =>
        id.getParentOrThrow().asKind(SyntaxKind.CallExpression)?.getExpression().getText()
      )
    expect(factoryUses).toEqual(['createIpcRegistrars'])
  })
})
