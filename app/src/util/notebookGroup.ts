export interface INotebookGroup {
    children: INotebookGroup[];
    name: string;
    notebooks: INotebook[];
    path: string;
}

export interface INotebookGroupTree {
    groups: INotebookGroup[];
    notebooks: INotebook[];
}

export const getNotebookDisplayName = (name: string) => {
    const names = name.split("/").map((item) => item.trim()).filter(Boolean);
    if (names.length < 2) {
        return name;
    }
    return names[names.length - 1];
};

export const buildNotebookGroupTree = (notebooks: INotebook[]): INotebookGroupTree => {
    const tree: INotebookGroupTree = {
        groups: [],
        notebooks: [],
    };

    notebooks.forEach((notebook) => {
        const names = notebook.name.split("/").map((item) => item.trim()).filter(Boolean);
        if (names.length < 2) {
            tree.notebooks.push(notebook);
            return;
        }

        let groups = tree.groups;
        let groupPath = "";
        names.slice(0, -1).forEach((name, index) => {
            groupPath = groupPath ? `${groupPath}/${name}` : name;
            let group = groups.find((item) => item.path === groupPath);
            if (!group) {
                group = {
                    children: [],
                    name,
                    notebooks: [],
                    path: groupPath,
                };
                groups.push(group);
            }
            groups = group.children;
            if (index === names.length - 2) {
                group.notebooks.push(notebook);
            }
        });
    });

    return tree;
};
