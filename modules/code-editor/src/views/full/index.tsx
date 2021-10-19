import { ModuleUI } from 'botpress/shared'
import { configure } from 'mobx'
import { Provider } from 'mobx-react'
import React from 'react'

import Editor from './Editor'
import SidePanel from './SidePanel'
import { RootStore } from './store'
import { KeyPosition } from './typings'

configure({ enforceActions: 'observed' })
const { Container } = ModuleUI

export default class CodeEditor extends React.Component<{ bp: any }> {
  private readonly store: RootStore

  constructor(props) {
    super(props)
    this.store = new RootStore({ bp: this.props.bp })
  }

  componentDidMount() {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.store.initialize()
  }

  render() {
    const keyMap = {
      newFile: 'ctrl+alt+n',
      cmdDown: { sequence: 'command', action: 'keydown' },
      ctrlDown: { sequence: 'ctrl', action: 'keydown' },
      shiftDown: { sequence: 'shift', action: 'keydown' },
      cmdUp: { sequence: 'command', action: 'keyup' },
      ctrlUp: { sequence: 'ctrl', action: 'keyup' },
      shiftUp: { sequence: 'shift', action: 'keyup' },
    }

    const keyHandlers = {
      newFile: this.store.createNewAction,
      cmdDown: () => this.store.updateKeyActionState('action', KeyPosition.DOWN),
      ctrlDown: () => this.store.updateKeyActionState('action', KeyPosition.DOWN),
      cmdUp: () =>this.store.updateKeyActionState('action', KeyPosition.UP),
      ctrlUp: () => this.store.updateKeyActionState('action', KeyPosition.UP),
      shiftDown: () => this.store.updateKeyActionState('shift', KeyPosition.DOWN),
      shiftUp: () => this.store.updateKeyActionState('shift', KeyPosition.UP),
    }

    return (
      <Provider store={this.store}>
        <Container keyHandlers={keyHandlers} keyMap={keyMap}>
          <SidePanel />
          <Editor />
        </Container>
      </Provider>
    )
  }
}
